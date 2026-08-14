// One-off migration: wipe all current students/families/guardians (and every
// record that hangs off them) and replace with a My Music Staff CSV export.
//
// Usage:
//   npx tsx scratch-migration/migrate-mms.ts            -> dry run, prints a summary only
//   npx tsx scratch-migration/migrate-mms.ts --commit    -> actually writes, inside one transaction
import 'reflect-metadata';
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { readFileSync } from 'fs';
import { sql, eq, inArray } from 'drizzle-orm';
import { createDb } from '../src/index';
import {
  organizations, staffMembers, families, students, guardians, enrollments,
  teacherAssignments, lessons, notes, resources, repertoirePieces, lessonCredits,
  lessonRequests, rescheduleRequests, invoices, invoiceLineItems, ledgerEntries,
  payments, paymentClaims, bankTransactions, payrollItems,
} from '../src/index';

const CSV_PATH = '/Users/priscachien/Downloads/ContactList-2026-08-07 (1).csv';
const COMMIT = process.argv.includes('--commit');

const db = createDb(process.env.DATABASE_URL!);

// ── Minimal RFC4180-ish CSV parser (mirrors apps/api/src/common/csv.ts) ──────
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function cleanName(s: string): string {
  return s.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function parseMoneyToPence(s: string): number {
  const n = parseFloat(s.replace(/[£,]/g, '').trim());
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function parseDob(s: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function splitMulti(s: string): string[] {
  return s.split(/;\s*/).map((x) => x.trim());
}

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// "DD/MM/YYYY HH:MM:SS" -> { weekday: 'monday', startTime: '16:00' }. The CSV's
// lesson timestamps are already studio-local (UK addresses, Europe/London studio),
// so we only need calendar weekday arithmetic — no timezone conversion.
function parseWeeklySlot(s: string): { weekday: string; startTime: string } | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):\d{2}$/.exec(s.trim());
  if (!m) return null;
  const [, dd, mo, yyyy, hh, min] = m;
  const dow = new Date(Date.UTC(Number(yyyy), Number(mo) - 1, Number(dd))).getUTCDay();
  return { weekday: WEEKDAY_NAMES[dow]!, startTime: `${hh}:${min}` };
}

interface Row {
  lastName: string; firstName: string; mmsStudentId: string; mmsFamilyId: string;
  adult: string; status: string; email: string; mobile: string;
  instrument: string; duration: string; lessonPrice: string; rate: string;
  makeupCredits: string; teacher: string; groupTags: string; birthday: string;
  parentContactLastName: string; parentContactFirstName: string; parentContactEmail: string;
  parentContactAddress: string; parentContactMobile: string; parentContactHomePhone: string;
  address: string; lastLesson: string; nextLesson: string;
}

function main() {
  const text = readFileSync(CSV_PATH, 'utf-8').replace(/^﻿/, '');
  const rows = parseCsv(text);
  const header = rows[0]!;
  const idx = (name: string) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`Missing CSV column: ${name}`);
    return i;
  };
  const H = {
    lastName: idx('Last Name'), firstName: idx('First Name'),
    mmsStudentId: idx('My Music Staff Student ID'), mmsFamilyId: idx('My Music Staff Family ID'),
    adult: idx('Adult Student'), status: idx('Status'), email: idx('Email'), mobile: idx('Mobile Phone'),
    instrument: idx('Instrument'), duration: idx('Duration'), lessonPrice: idx('Lesson Price'),
    rate: idx('Rate'), makeupCredits: idx('Make-up Credits'), teacher: idx('Teacher'),
    groupTags: idx('Group Tags'), birthday: idx('Birthday'), address: idx('Address'),
    parentContactLastName: idx('Parent Contact 1 Last Name'), parentContactFirstName: idx('Parent Contact 1 First Name'),
    parentContactEmail: idx('Parent Contact 1 Email'), parentContactAddress: idx('Parent Contact 1 Address'),
    parentContactMobile: idx('Parent Contact 1 Mobile Phone'), parentContactHomePhone: idx('Parent Contact 1 Home Phone'),
    lastLesson: idx('Last Lesson'), nextLesson: idx('Next Lesson'),
  };

  const dataRows: Row[] = rows.slice(1)
    .filter((r) => r.some((c) => c.trim() !== ''))
    // Exclude the literal "test test" junk row (fml_s71dJf) — not a real student.
    .filter((r) => !(r[H.firstName]?.trim().toLowerCase() === 'test' && r[H.lastName]?.trim().toLowerCase() === 'test'))
    .map((r) => ({
    lastName: r[H.lastName] ?? '', firstName: r[H.firstName] ?? '',
    mmsStudentId: r[H.mmsStudentId] ?? '', mmsFamilyId: r[H.mmsFamilyId] ?? '',
    adult: r[H.adult] ?? '', status: r[H.status] ?? '', email: r[H.email] ?? '', mobile: r[H.mobile] ?? '',
    instrument: r[H.instrument] ?? '', duration: r[H.duration] ?? '', lessonPrice: r[H.lessonPrice] ?? '',
    rate: r[H.rate] ?? '', makeupCredits: r[H.makeupCredits] ?? '', teacher: r[H.teacher] ?? '',
    groupTags: r[H.groupTags] ?? '', birthday: r[H.birthday] ?? '', address: r[H.address] ?? '',
    parentContactLastName: r[H.parentContactLastName] ?? '', parentContactFirstName: r[H.parentContactFirstName] ?? '',
    parentContactEmail: r[H.parentContactEmail] ?? '', parentContactAddress: r[H.parentContactAddress] ?? '',
    parentContactMobile: r[H.parentContactMobile] ?? '', parentContactHomePhone: r[H.parentContactHomePhone] ?? '',
    lastLesson: r[H.lastLesson] ?? '', nextLesson: r[H.nextLesson] ?? '',
  }));

  // ── Group into families ────────────────────────────────────────────────
  const familyGroups = new Map<string, Row[]>();
  for (const row of dataRows) {
    const key = row.mmsFamilyId || `NOFAM_${row.mmsStudentId}`;
    if (!familyGroups.has(key)) familyGroups.set(key, []);
    familyGroups.get(key)!.push(row);
  }

  // ── Collect unique teacher names ───────────────────────────────────────
  const teacherNames = new Set<string>();
  let enrollmentCount = 0;
  let unspecifiedInstrumentCount = 0;
  let mismatchedMultiCount = 0;
  let emptyEnrollmentStudents = 0;
  let negativeCreditsCount = 0;
  let positiveCreditsTotal = 0;
  let scheduleRuleCount = 0;
  let ambiguousMultiEnrollmentSchedule = 0;
  const adultCount = dataRows.filter((r) => r.adult.trim() === 'Adult').length;

  for (const row of dataRows) {
    const teachers = splitMulti(row.teacher).filter(Boolean);
    const durations = splitMulti(row.duration).filter(Boolean);
    const rates = splitMulti(row.rate).filter(Boolean);
    if (durations.length === 0) { emptyEnrollmentStudents++; continue; }
    if (teachers.length !== durations.length || rates.length !== durations.length) mismatchedMultiCount++;
    const n = Math.min(teachers.length || durations.length, durations.length, rates.length || durations.length);
    for (let i = 0; i < n; i++) {
      enrollmentCount++;
      const t = teachers[i];
      if (t) teacherNames.add(t.trim());
      const inst = row.groupTags.trim() || row.instrument.trim();
      if (!inst) unspecifiedInstrumentCount++;
    }
    const slot = parseWeeklySlot(row.nextLesson) ?? parseWeeklySlot(row.lastLesson);
    if (slot) { if (n === 1) scheduleRuleCount++; else ambiguousMultiEnrollmentSchedule++; }
    const credits = parseInt(row.makeupCredits, 10);
    if (Number.isFinite(credits)) {
      if (credits < 0) negativeCreditsCount++;
      else positiveCreditsTotal += credits;
    }
  }

  console.log('═══ MMS CSV IMPORT — DRY-RUN SUMMARY ═══');
  console.log(`Data rows (students): ${dataRows.length}`);
  console.log(`Families (grouped by MMS Family ID): ${familyGroups.size}`);
  console.log(`Adult students (no separate guardian): ${adultCount}`);
  console.log(`Total enrollments to create: ${enrollmentCount}`);
  console.log(`  - with no instrument tag (will be set to "Unspecified"): ${unspecifiedInstrumentCount}`);
  console.log(`Students with zero enrollments (no Duration/Rate on file): ${emptyEnrollmentStudents}`);
  console.log(`Rows where Teacher/Duration/Rate counts didn't line up (best-effort truncated): ${mismatchedMultiCount}`);
  console.log(`Rows with a NEGATIVE make-up-credit count (${negativeCreditsCount} rows — can't represent a debt, skipped; credit rows only created for positive counts)`);
  console.log(`Make-up/prepaid credit rows to create (sum of positive counts): ${positiveCreditsTotal}`);
  console.log(`Unique teacher names referenced: ${teacherNames.size}`);
  console.log([...teacherNames].sort().join(', '));
  console.log(`Enrollments getting a weekly scheduleRule (single-enrollment rows with a parseable Next/Last Lesson date): ${scheduleRuleCount}`);
  console.log(`Multi-enrollment rows skipped for auto-scheduling (ambiguous which enrollment the Next/Last Lesson time belongs to): ${ambiguousMultiEnrollmentSchedule}`);
  console.log('NOTE: "test test" row (fml_s71dJf) is excluded.');
  console.log('NOTE: calendar lessons will be materialized (12 weeks ahead) for every enrollment that gets a scheduleRule, via the same service the app uses for recurring bookings.');

  if (!COMMIT) {
    console.log('\nDry run only — no database changes made. Re-run with --commit to execute.');
    process.exit(0);
  }

  void runCommit(dataRows, familyGroups, teacherNames);
}

async function runCommit(
  dataRows: Row[],
  familyGroups: Map<string, Row[]>,
  teacherNames: Set<string>,
) {
  const org = await db.query.organizations.findFirst();
  if (!org) throw new Error('No organization found');
  const orgId = org.id;

  const enrollmentsNeedingSchedule = await db.transaction(async (tx) => {
    // ── 1. Wipe all current students/families and everything dependent ──
    const oldStudents = await tx.query.students.findMany({ where: eq(students.organizationId, orgId), columns: { id: true } });
    const oldStudentIds = oldStudents.map((s) => s.id);
    const oldFamilies = await tx.query.families.findMany({ where: eq(families.organizationId, orgId), columns: { id: true } });
    const oldFamilyIds = oldFamilies.map((f) => f.id);

    if (oldStudentIds.length) {
      const oldLessons = await tx.query.lessons.findMany({ where: inArray(lessons.studentId, oldStudentIds), columns: { id: true } });
      const oldLessonIds = oldLessons.map((l) => l.id);

      await tx.delete(lessonRequests).where(inArray(lessonRequests.studentId, oldStudentIds));
      await tx.delete(lessonCredits).where(inArray(lessonCredits.studentId, oldStudentIds));
      await tx.delete(notes).where(inArray(notes.studentId, oldStudentIds));
      await tx.delete(resources).where(inArray(resources.studentId, oldStudentIds));
      await tx.delete(repertoirePieces).where(inArray(repertoirePieces.studentId, oldStudentIds));

      if (oldLessonIds.length) {
        await tx.delete(rescheduleRequests).where(inArray(rescheduleRequests.lessonId, oldLessonIds));
        await tx.update(payrollItems).set({ lessonId: null }).where(inArray(payrollItems.lessonId, oldLessonIds));
      }
    }

    if (oldFamilyIds.length) {
      await tx.update(bankTransactions).set({ matchedFamilyId: null, matchedClaimId: null, paymentId: null })
        .where(inArray(bankTransactions.matchedFamilyId, oldFamilyIds));
      await tx.delete(paymentClaims).where(inArray(paymentClaims.familyId, oldFamilyIds));
      await tx.delete(payments).where(inArray(payments.familyId, oldFamilyIds));
      await tx.delete(ledgerEntries).where(inArray(ledgerEntries.familyId, oldFamilyIds));
      await tx.delete(invoices).where(inArray(invoices.familyId, oldFamilyIds)); // cascades invoice_line_items
    }

    if (oldStudentIds.length) {
      await tx.delete(lessons).where(inArray(lessons.studentId, oldStudentIds)); // cascades attendance
      await tx.delete(enrollments).where(inArray(enrollments.studentId, oldStudentIds));
    }

    await tx.delete(students).where(eq(students.organizationId, orgId)); // cascades teacher_assignments
    await tx.delete(families).where(eq(families.organizationId, orgId)); // cascades guardians

    console.log(`Deleted ${oldStudentIds.length} old students, ${oldFamilyIds.length} old families (and dependents).`);

    // ── 2. Ensure staff rows exist for every teacher name in the CSV ────
    const existingStaff = await tx.query.staffMembers.findMany({ where: eq(staffMembers.organizationId, orgId) });
    const staffByName = new Map<string, string>();
    for (const s of existingStaff) staffByName.set(`${s.firstName} ${s.lastName}`.trim().toLowerCase(), s.id);

    for (const fullName of teacherNames) {
      const key = fullName.trim().toLowerCase();
      if (staffByName.has(key)) continue;
      const parts = fullName.trim().split(/\s+/);
      const firstName = parts[0] ?? fullName;
      const lastName = parts.slice(1).join(' ') || '(unknown)';
      const [created] = await tx.insert(staffMembers).values({
        organizationId: orgId, userId: null, firstName, lastName,
        instruments: [], defaultDuration: 60, hourlyRate: 0, status: 'active',
      }).returning({ id: staffMembers.id });
      staffByName.set(key, created!.id);
    }
    console.log(`Ensured ${teacherNames.size} teacher staff rows exist (created ones with no login).`);

    // ── 3. Insert families + students + enrollments from the CSV ────────
    let familiesCreated = 0, studentsCreated = 0, enrollmentsCreated = 0, creditsCreated = 0;
    const enrollmentsNeedingSchedule: string[] = [];

    for (const [, rowsForFamily] of familyGroups) {
      const first = rowsForFamily[0]!;
      const contactFirst = first.parentContactFirstName.trim() || first.firstName.trim();
      const contactLast = cleanName(first.parentContactLastName.trim() || first.lastName.trim());
      const contactName = `${contactFirst} ${contactLast}`.trim();
      const familyEmail = (first.parentContactEmail || first.email || '').trim().toLowerCase() || null;
      const familyPhone = (first.parentContactMobile || first.parentContactHomePhone || first.mobile || '').trim() || null;
      const familyAddress = (first.parentContactAddress || first.address || '').trim() || null;

      const [family] = await tx.insert(families).values({
        organizationId: orgId,
        name: `${contactLast || contactFirst} Family`,
        contactName: contactName || null,
        address: familyAddress,
        phone: familyPhone,
        email: familyEmail,
      }).returning({ id: families.id });
      familiesCreated++;

      for (const row of rowsForFamily) {
        const dob = parseDob(row.birthday);
        const [student] = await tx.insert(students).values({
          organizationId: orgId,
          familyId: family!.id,
          firstName: cleanName(row.firstName) || row.firstName,
          lastName: cleanName(row.lastName) || row.lastName,
          dob,
          email: row.email.trim().toLowerCase() || null,
          status: 'active',
        }).returning({ id: students.id });
        studentsCreated++;

        // Positive make-up/prepaid credit count -> that many available "makeup"
        // credit rows for the student (negative counts can't be represented —
        // there's no debt concept in lesson_credits — so those are skipped).
        const creditCount = parseInt(row.makeupCredits, 10);
        if (Number.isFinite(creditCount) && creditCount > 0) {
          for (let c = 0; c < creditCount; c++) {
            await tx.insert(lessonCredits).values({
              organizationId: orgId, studentId: student!.id, type: 'makeup', status: 'available',
            });
            creditsCreated++;
          }
        }

        const teachers = splitMulti(row.teacher).filter(Boolean);
        const durations = splitMulti(row.duration).filter(Boolean);
        const rates = splitMulti(row.rate).filter(Boolean);
        if (durations.length === 0) continue;
        const n = Math.min(teachers.length || durations.length, durations.length, rates.length || durations.length);
        const instrument = row.groupTags.trim() || row.instrument.trim() || 'Unspecified';
        // Only assign an auto-schedule when there's exactly one enrollment — with
        // several, the CSV's single Next/Last Lesson timestamp can't be attributed
        // to a specific one, so leave scheduleRule unset (admin sets it by hand).
        const slot = n === 1 ? (parseWeeklySlot(row.nextLesson) ?? parseWeeklySlot(row.lastLesson)) : null;

        for (let i = 0; i < n; i++) {
          const durationMin = parseInt(durations[i]!, 10) || 30;
          const ratePence = parseMoneyToPence(rates[i] ?? '');
          const teacherName = teachers[i]?.trim().toLowerCase();
          const teacherId = teacherName ? staffByName.get(teacherName) ?? null : null;

          const [enrollment] = await tx.insert(enrollments).values({
            organizationId: orgId,
            studentId: student!.id,
            instrument,
            lessonType: 'private',
            teacherId,
            rate: ratePence,
            defaultDuration: durationMin,
            status: 'active',
            scheduleRule: slot ?? null,
          }).returning({ id: enrollments.id });
          enrollmentsCreated++;
          if (slot && teacherId) enrollmentsNeedingSchedule.push(enrollment!.id);
        }
      }
    }

    console.log(`Created ${familiesCreated} families, ${studentsCreated} students, ${enrollmentsCreated} enrollments, ${creditsCreated} make-up credit rows.`);
    console.log(`${enrollmentsNeedingSchedule.length} enrollments have a weekly scheduleRule + teacher and will be materialized onto the calendar next.`);
    return enrollmentsNeedingSchedule;
  });

  console.log('\n✓ Committed.');

  // ── 4. Materialize calendar lessons for every enrollment that got a schedule ──
  // Reuses the app's own SchedulingService.materializeEnrollment (same code path
  // as POST /lessons/recurring) so conflict-checking, dedupe (seriesSlotAt) and
  // studio-timezone handling are identical to a normal recurring booking.
  const { DbService } = await import('../../../apps/api/src/db/db.service');
  const { SchedulingService } = await import('../../../apps/api/src/scheduling/scheduling.service');
  const dbService = new DbService();
  const scheduling = new SchedulingService(dbService, {} as never);

  let totalLessonsCreated = 0, totalSkippedConflicts = 0, materializeFailed = 0;
  for (const enrollmentId of enrollmentsNeedingSchedule) {
    try {
      const res = await scheduling.materializeEnrollment(orgId, enrollmentId, { weeks: 12 });
      totalLessonsCreated += res.created;
      totalSkippedConflicts += res.skippedConflicts;
    } catch (err) {
      materializeFailed++;
      console.warn(`  materialize failed for enrollment ${enrollmentId}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`\n✓ Calendar backfill: ${totalLessonsCreated} lessons created across ${enrollmentsNeedingSchedule.length} enrollments (${totalSkippedConflicts} skipped as conflicts, ${materializeFailed} enrollments failed).`);
  process.exit(0);
}

main();
