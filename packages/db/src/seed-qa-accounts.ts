/**
 * QA fixture accounts for pre-launch portal testing.
 * Run with: pnpm --filter @music-life/db seed:qa
 *
 * Idempotent — safe to re-run; every row is looked up by a stable key first.
 *
 * Deliberately covers the shapes a single-student/single-teacher fixture cannot:
 *   • a student learning TWO instruments (Hana — piano + violin)
 *   • a teacher teaching TWO instruments (both new teachers)
 *   • one family with TWO children, on different instruments, with DIFFERENT
 *     teachers, one of them in a GROUP class
 *   • a student with their own login, so the student portal can be checked
 *     against the parent portal for the same family
 *
 * Everything is marked (TEST) and must be deleted before launch.
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { eq, and } from 'drizzle-orm';
import { hash } from 'argon2';
import {
  createDb,
  organizations, users, memberships,
  staffMembers, staffAvailability, families, guardians, students, enrollments,
} from './index';

const db = createDb(process.env.DATABASE_URL!);

// Matches the existing qa.* fixtures so there is only one password to remember
// while testing. These accounts are throwaway and go before launch.
const PASSWORD = 'asdf';

type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

async function upsertUser(email: string) {
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  const passwordHash = await hash(PASSWORD);
  if (existing) {
    await db.update(users).set({ passwordHash, emailVerifiedAt: new Date() }).where(eq(users.id, existing.id));
    return existing.id;
  }
  const [u] = await db.insert(users).values({ email, passwordHash, emailVerifiedAt: new Date() }).returning();
  return u!.id;
}

async function upsertMembership(userId: string, orgId: string, baseRole: 'teacher' | 'guardian' | 'student') {
  const existing = await db.query.memberships.findFirst({
    where: and(eq(memberships.userId, userId), eq(memberships.organizationId, orgId)),
  });
  if (!existing) {
    await db.insert(memberships).values({ userId, organizationId: orgId, baseRole });
  } else if (existing.baseRole !== baseRole) {
    await db.update(memberships).set({ baseRole }).where(eq(memberships.id, existing.id));
  }
}

async function upsertTeacher(orgId: string, opts: {
  email: string; firstName: string; lastName: string;
  instruments: string[]; hourlyRate: number; availability: { weekday: Weekday; startTime: string; endTime: string }[];
}) {
  const userId = await upsertUser(opts.email);
  await upsertMembership(userId, orgId, 'teacher');

  let staff = await db.query.staffMembers.findFirst({
    where: and(eq(staffMembers.organizationId, orgId), eq(staffMembers.userId, userId)),
  });
  if (staff) {
    await db.update(staffMembers)
      .set({ instruments: opts.instruments, hourlyRate: opts.hourlyRate, status: 'active', updatedAt: new Date() })
      .where(eq(staffMembers.id, staff.id));
  } else {
    const [created] = await db.insert(staffMembers).values({
      organizationId: orgId, userId,
      firstName: opts.firstName, lastName: opts.lastName,
      title: 'Teacher', instruments: opts.instruments,
      defaultDuration: 60, hourlyRate: opts.hourlyRate, status: 'active',
    }).returning();
    staff = created!;
  }

  for (const w of opts.availability) {
    const existing = await db.query.staffAvailability.findFirst({
      where: and(
        eq(staffAvailability.staffId, staff.id),
        eq(staffAvailability.weekday, w.weekday),
        eq(staffAvailability.startTime, w.startTime),
      ),
    });
    if (!existing) {
      await db.insert(staffAvailability).values({
        organizationId: orgId, staffId: staff.id,
        weekday: w.weekday, startTime: w.startTime, endTime: w.endTime,
      });
    }
  }

  console.log(`  teacher ${opts.firstName} ${opts.lastName} — ${opts.instruments.join(', ')} — ${opts.email}`);
  return staff;
}

async function upsertFamily(orgId: string, name: string, contactName: string, parentEmail: string) {
  let family = await db.query.families.findFirst({
    where: and(eq(families.organizationId, orgId), eq(families.name, name)),
  });
  if (!family) {
    const [created] = await db.insert(families).values({
      organizationId: orgId, name, contactName, email: parentEmail,
      invoiceMode: 'monthly_statement',
    }).returning();
    family = created!;
  }

  const parentUserId = await upsertUser(parentEmail);
  await upsertMembership(parentUserId, orgId, 'guardian');
  const existingG = await db.query.guardians.findFirst({
    where: and(eq(guardians.familyId, family.id), eq(guardians.userId, parentUserId)),
  });
  if (!existingG) {
    await db.insert(guardians).values({
      organizationId: orgId, familyId: family.id, userId: parentUserId, relationship: 'parent',
    });
  }

  console.log(`  family ${name} — parent login ${parentEmail}`);
  return family;
}

async function upsertStudent(orgId: string, familyId: string, firstName: string, lastName: string, loginEmail?: string) {
  let student = await db.query.students.findFirst({
    where: and(eq(students.organizationId, orgId), eq(students.familyId, familyId), eq(students.firstName, firstName)),
  });
  let studentUserId: string | undefined;
  if (loginEmail) {
    studentUserId = await upsertUser(loginEmail);
    await upsertMembership(studentUserId, orgId, 'student');
  }
  if (student) {
    await db.update(students)
      .set({ status: 'active', ...(studentUserId ? { studentUserId } : {}), updatedAt: new Date() })
      .where(eq(students.id, student.id));
  } else {
    const [created] = await db.insert(students).values({
      organizationId: orgId, familyId, firstName, lastName,
      status: 'active', ...(studentUserId ? { studentUserId } : {}),
    }).returning();
    student = created!;
  }
  console.log(`  student ${firstName} ${lastName}${loginEmail ? ` — login ${loginEmail}` : ''}`);
  return student;
}

async function upsertEnrollment(orgId: string, studentId: string, opts: {
  instrument: string; lessonType: 'private' | 'group'; groupName?: string;
  teacherId: string; rate: number; duration: number;
  weekday: Weekday; startTime: string;
}) {
  const existing = await db.query.enrollments.findFirst({
    where: and(
      eq(enrollments.organizationId, orgId),
      eq(enrollments.studentId, studentId),
      eq(enrollments.instrument, opts.instrument),
    ),
  });
  const values = {
    instrument: opts.instrument,
    lessonType: opts.lessonType,
    groupName: opts.groupName ?? null,
    teacherId: opts.teacherId,
    rate: opts.rate,
    defaultDuration: opts.duration,
    scheduleRule: { weekday: opts.weekday, startTime: opts.startTime },
    status: 'active' as const,
  };
  if (existing) {
    await db.update(enrollments).set(values).where(eq(enrollments.id, existing.id));
  } else {
    await db.insert(enrollments).values({ organizationId: orgId, studentId, ...values });
  }
  console.log(`    ↳ ${opts.instrument} (${opts.lessonType}${opts.groupName ? `: ${opts.groupName}` : ''}) ` +
    `£${(opts.rate / 100).toFixed(2)}/${opts.duration}min · ${opts.weekday} ${opts.startTime}`);
}

async function main() {
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'music-and-life') });
  if (!org) { console.error('Org not found'); process.exit(1); }
  const orgId = org.id;

  console.log('\nTeachers…');
  // Multi-instrument teacher #1 — overlaps with #2 on violin so a family can be
  // moved between teachers for the same instrument.
  const mari = await upsertTeacher(orgId, {
    email: 'qa2.teacher@lirico.test',
    firstName: 'Mari', lastName: 'Ono (TEST)',
    instruments: ['piano', 'guitar'],
    hourlyRate: 3500,
    availability: [
      { weekday: 'monday',   startTime: '15:00', endTime: '20:00' },
      { weekday: 'thursday', startTime: '10:00', endTime: '18:00' },
      { weekday: 'saturday', startTime: '09:00', endTime: '13:00' },
    ],
  });
  const tom = await upsertTeacher(orgId, {
    email: 'qa3.teacher@lirico.test',
    firstName: 'Tom', lastName: 'Beck (TEST)',
    instruments: ['violin', 'cello', 'suzuki violin'],
    hourlyRate: 4000,
    availability: [
      { weekday: 'tuesday', startTime: '14:00', endTime: '19:00' },
      { weekday: 'friday',  startTime: '14:00', endTime: '19:00' },
    ],
  });

  console.log('\nFamily 1 — two children, different instruments, different teachers, one group class…');
  const nakamura = await upsertFamily(orgId, 'Nakamura QA Family (TEST)', 'Aiko Nakamura (TEST)', 'qa2.parent@lirico.test');

  const hana = await upsertStudent(orgId, nakamura.id, 'Hana', 'Nakamura (TEST)');
  // Two instruments, two different teachers — the multi-teacher family case.
  await upsertEnrollment(orgId, hana.id, {
    instrument: 'piano', lessonType: 'private', teacherId: mari.id,
    rate: 4500, duration: 60, weekday: 'monday', startTime: '16:00',
  });
  await upsertEnrollment(orgId, hana.id, {
    instrument: 'violin', lessonType: 'private', teacherId: tom.id,
    rate: 3500, duration: 30, weekday: 'friday', startTime: '15:00',
  });

  const kenji = await upsertStudent(orgId, nakamura.id, 'Kenji', 'Nakamura (TEST)');
  await upsertEnrollment(orgId, kenji.id, {
    instrument: 'guitar', lessonType: 'private', teacherId: mari.id,
    rate: 5250, duration: 45, weekday: 'thursday', startTime: '17:00',
  });
  await upsertEnrollment(orgId, kenji.id, {
    instrument: 'suzuki violin', lessonType: 'group', groupName: 'Suzuki Group A (TEST)',
    teacherId: tom.id, rate: 2500, duration: 60, weekday: 'tuesday', startTime: '17:00',
  });

  console.log('\nFamily 2 — one child with their own student login…');
  const adeyemi = await upsertFamily(orgId, 'Adeyemi QA Family (TEST)', 'Femi Adeyemi (TEST)', 'qa3.parent@lirico.test');
  const tunde = await upsertStudent(orgId, adeyemi.id, 'Tunde', 'Adeyemi (TEST)', 'qa3.student@lirico.test');
  await upsertEnrollment(orgId, tunde.id, {
    instrument: 'cello', lessonType: 'private', teacherId: tom.id,
    rate: 4500, duration: 60, weekday: 'tuesday', startTime: '15:00',
  });
  // Same student, second instrument with the OTHER teacher — so the student
  // portal has to cope with two teachers too, not just the parent portal.
  await upsertEnrollment(orgId, tunde.id, {
    instrument: 'piano', lessonType: 'private', teacherId: mari.id,
    rate: 4500, duration: 60, weekday: 'saturday', startTime: '10:00',
  });

  console.log(`\n✓ Done. All accounts use the password: ${PASSWORD}\n`);
  console.log('  qa2.teacher@lirico.test   Mari Ono (TEST)      piano, guitar');
  console.log('  qa3.teacher@lirico.test   Tom Beck (TEST)      violin, cello, suzuki violin');
  console.log('  qa2.parent@lirico.test    Nakamura family      Hana (piano+violin), Kenji (guitar+suzuki group)');
  console.log('  qa3.parent@lirico.test    Adeyemi family       Tunde (cello+piano)');
  console.log('  qa3.student@lirico.test   Tunde Adeyemi (TEST) student-portal login\n');
  console.log('  Delete all of these before launch.\n');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
