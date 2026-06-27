/**
 * Populates every remaining empty table so the whole app has demo data to show:
 * repertoire, reschedule requests, rate change requests, payroll, expenses,
 * notification rules/log, teacher availability/blocked time, and pending registrations.
 * Run with: pnpm --filter @music-life/db seed:extra (after seed:bulk)
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { eq, and } from 'drizzle-orm';
import {
  createDb, organizations, staffMembers, students, enrollments, lessons,
  repertoirePieces, rescheduleRequests, rateChangeRequests,
  payrollRuns, payrollItems, expenses, notificationRules, notificationLog,
  availability, blockedTime, registrations, users, guardians,
} from './index';

const db = createDb(process.env.DATABASE_URL!);

let seed = 7;
function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function pick<T>(arr: readonly T[]): T { return arr[Math.floor(rand() * arr.length)]!; }
function randInt(min: number, max: number) { return min + Math.floor(rand() * (max - min + 1)); }
function shuffle<T>(arr: T[]): T[] { return arr.map(a => [rand(), a] as const).sort((a, b) => a[0] - b[0]).map(a => a[1]); }
function dateStr(d: Date) { return d.toISOString().split('T')[0]!; }

const PIECE_TITLES: Record<string, { title: string; composer: string }[]> = {
  piano: [{ title: 'Minuet in G', composer: 'J.S. Bach' }, { title: 'Für Elise', composer: 'Beethoven' }, { title: 'Clair de Lune', composer: 'Debussy' }],
  violin: [{ title: 'Suzuki Book 2 No. 4', composer: 'Suzuki' }, { title: 'Concerto in A minor', composer: 'Vivaldi' }],
  guitar: [{ title: 'Romance (Spanish Romance)', composer: 'Anonymous' }, { title: 'Blackbird', composer: 'Lennon/McCartney' }],
  cello: [{ title: 'The Swan', composer: 'Saint-Saëns' }, { title: 'Suzuki Book 1 No. 10', composer: 'Suzuki' }],
  viola: [{ title: 'Suzuki Book 1 No. 8', composer: 'Suzuki' }],
  drums: [{ title: 'Rudiment Workbook — Single Stroke Roll', composer: 'Trad.' }],
  vocal: [{ title: 'Hallelujah', composer: 'Leonard Cohen' }, { title: 'Somewhere Over the Rainbow', composer: 'Arlen' }],
  'bass guitar': [{ title: 'Walking Bassline in C', composer: 'Trad.' }],
  ukulele: [{ title: 'Riptide', composer: 'Vance Joy' }],
};
const REPERTOIRE_STATUS = ['learning', 'polishing', 'performance_ready', 'completed'] as const;
const EXPENSE_CATEGORIES = ['Travel', 'Sheet music', 'Instrument maintenance', 'Teaching materials'] as const;
const NOTIFICATION_RULE_DEFS = [
  { triggerEvent: 'lesson_reminder_24h', templateId: 'lesson-reminder', channels: ['email'] },
  { triggerEvent: 'invoice_overdue', templateId: 'invoice-overdue', channels: ['email'] },
  { triggerEvent: 'payment_received', templateId: 'payment-received', channels: ['email'] },
  { triggerEvent: 'registration_approved', templateId: 'registration-approved', channels: ['email'] },
  { triggerEvent: 'makeup_credit_expiring', templateId: 'credit-expiring', channels: ['email'] },
];

async function main() {
  console.log('Starting extra seed (remaining tables)…\n');
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'music-and-life') });
  if (!org) { console.error('Org not found — run `pnpm --filter @music-life/db seed` first'); process.exit(1); }
  const orgId = org.id;

  const allTeachers = await db.query.staffMembers.findMany({ where: eq(staffMembers.organizationId, orgId) });
  const allStudents = await db.query.students.findMany({ where: eq(students.organizationId, orgId) });
  const allEnrollments = await db.query.enrollments.findMany({ where: eq(enrollments.organizationId, orgId) });
  const completedLessons = await db.query.lessons.findMany({
    where: and(eq(lessons.organizationId, orgId), eq(lessons.status, 'completed')),
  });
  const scheduledLessons = await db.query.lessons.findMany({
    where: and(eq(lessons.organizationId, orgId), eq(lessons.status, 'scheduled')),
  });
  const studentById = new Map(allStudents.map(s => [s.id, s]));

  // ── 1. Repertoire pieces ──────────────────────────────────────────────────────
  console.log('Creating repertoire pieces…');
  const activeStudents = shuffle(allStudents.filter(s => s.status === 'active')).slice(0, 60);
  let pieceCount = 0;
  for (const stu of activeStudents) {
    const en = allEnrollments.find(e => e.studentId === stu.id);
    if (!en) continue;
    const pool = PIECE_TITLES[en.instrument] ?? PIECE_TITLES.piano!;
    const numPieces = randInt(1, 2);
    for (let i = 0; i < numPieces; i++) {
      const piece = pick(pool);
      await db.insert(repertoirePieces).values({
        organizationId: orgId, studentId: stu.id, teacherId: en.teacherId ?? undefined,
        title: piece.title, composer: piece.composer, instrument: en.instrument,
        status: pick(REPERTOIRE_STATUS),
      });
      pieceCount++;
    }
  }
  console.log(`  ${pieceCount} repertoire pieces`);

  // ── 2. Reschedule requests ────────────────────────────────────────────────────
  console.log('Creating reschedule requests…');
  const loginGuardians = await db.query.guardians.findMany({ where: eq(guardians.organizationId, orgId), limit: 10 });
  const reschedSample = shuffle([...scheduledLessons]).slice(0, Math.min(8, scheduledLessons.length));
  let reschedCount = 0;
  for (const lesson of reschedSample) {
    const stu = studentById.get(lesson.studentId);
    const guardian = loginGuardians.find(g => g.familyId === stu?.familyId) ?? pick(loginGuardians);
    if (!guardian) continue;
    const proposed = new Date(lesson.startsAt.getTime() + randInt(1, 3) * 86400000);
    const status = pick(['pending', 'pending', 'approved', 'denied'] as const);
    await db.insert(rescheduleRequests).values({
      organizationId: orgId, lessonId: lesson.id, requestedBy: guardian.userId,
      proposedStartsAt: proposed, status,
      reason: pick(['Family holiday', 'School event clash', 'Doctor appointment', 'Sibling commitment']),
      decidedAt: status === 'pending' ? undefined : new Date(),
    });
    reschedCount++;
  }
  console.log(`  ${reschedCount} reschedule requests`);

  // ── 3. Rate change requests ───────────────────────────────────────────────────
  console.log('Creating rate change requests…');
  const rateSample = shuffle([...allTeachers]).slice(0, Math.min(4, allTeachers.length));
  for (const t of rateSample) {
    const requested = t.hourlyRate + pick([300, 500, -200]);
    await db.insert(rateChangeRequests).values({
      organizationId: orgId, staffId: t.id, currentRate: t.hourlyRate, requestedRate: requested,
      status: pick(['pending', 'approved', 'denied'] as const),
      reason: 'Annual rate review based on experience and qualifications.',
    });
  }
  console.log(`  ${rateSample.length} rate change requests`);

  // ── 4. Payroll runs + items (last calendar month, per teacher) ──────────────
  console.log('Creating payroll runs + items…');
  const now = new Date();
  // Covers the "3 weeks back … this week" window seed-bulk.ts schedules completed lessons in.
  const periodStart = new Date(now.getTime() - 30 * 86400000);
  const periodEnd = now;
  let payrollRunCount = 0, payrollItemCount = 0;
  for (const t of allTeachers) {
    const teacherLessons = completedLessons.filter(l => l.teacherId === t.id
      && l.startsAt >= periodStart && l.startsAt <= periodEnd);
    if (teacherLessons.length === 0) continue;
    const minutesElapsed = teacherLessons.reduce((s, l) => s + l.duration, 0);
    const hoursElapsed = Math.round(minutesElapsed / 60);
    const gross = Math.round((minutesElapsed / 60) * t.hourlyRate);
    const status = pick(['draft', 'approved', 'paid'] as const);
    const [run] = await db.insert(payrollRuns).values({
      organizationId: orgId, staffId: t.id,
      periodStart: dateStr(periodStart), periodEnd: dateStr(periodEnd),
      hoursElapsed, hourlyRate: t.hourlyRate, gross, status,
      approvedAt: status === 'draft' ? undefined : new Date(),
    }).returning();
    payrollRunCount++;

    for (const l of teacherLessons) {
      await db.insert(payrollItems).values({
        organizationId: orgId, payrollRunId: run!.id, lessonId: l.id,
        type: 'lesson', minutesElapsed: l.duration,
        amount: Math.round((l.duration / 60) * t.hourlyRate),
      });
      payrollItemCount++;
    }
  }
  console.log(`  ${payrollRunCount} payroll runs, ${payrollItemCount} payroll items`);

  // ── 5. Expenses ────────────────────────────────────────────────────────────────
  console.log('Creating staff expenses…');
  const expenseSample = shuffle([...allTeachers]).slice(0, Math.min(8, allTeachers.length));
  for (const t of expenseSample) {
    const category = pick(EXPENSE_CATEGORIES);
    const d = new Date(); d.setDate(d.getDate() - randInt(1, 25));
    await db.insert(expenses).values({
      organizationId: orgId, staffId: t.id, category,
      amount: category === 'Travel' ? randInt(500, 3000) : randInt(800, 6000),
      mileageKm: category === 'Travel' ? randInt(5, 40) : undefined,
      date: dateStr(d), description: `${category} — ${dateStr(d)}`,
      status: pick(['pending', 'approved', 'rejected'] as const),
    });
  }
  console.log(`  ${expenseSample.length} expenses`);

  // ── 6. Notification rules + log ───────────────────────────────────────────────
  console.log('Creating notification rules + log…');
  const insertedRules = await db.insert(notificationRules).values(
    NOTIFICATION_RULE_DEFS.map(r => ({ organizationId: orgId, ...r, enabled: true })),
  ).returning();

  const sampleUsers = await db.query.users.findMany({ limit: 12 });
  let logCount2 = 0;
  for (const rule of insertedRules) {
    const n = randInt(2, 5);
    for (let i = 0; i < n; i++) {
      const u = pick(sampleUsers);
      await db.insert(notificationLog).values({
        organizationId: orgId, ruleId: rule.id, userId: u?.id,
        channel: pick(rule.channels as string[]),
        status: pick(['sent', 'sent', 'sent', 'failed', 'skipped'] as const),
      });
      logCount2++;
    }
  }
  console.log(`  ${insertedRules.length} notification rules, ${logCount2} notification log entries`);

  // ── 7. Teacher availability + blocked time ───────────────────────────────────
  console.log('Creating teacher availability + blocked time…');
  const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;
  let availCount = 0, blockedCount = 0;
  for (const t of allTeachers) {
    const days = shuffle([...WEEKDAYS]).slice(0, randInt(3, 5));
    for (const day of days) {
      await db.insert(availability).values({
        organizationId: orgId, staffId: t.id, weekday: day,
        startTime: pick(['09:00', '10:00', '14:00']),
        endTime: pick(['17:00', '18:00', '19:00']),
      });
      availCount++;
    }
    if (rand() < 0.5) {
      const d = new Date(); d.setDate(d.getDate() + randInt(1, 10));
      d.setHours(12, 0, 0, 0);
      await db.insert(blockedTime).values({
        organizationId: orgId, staffId: t.id,
        startsAt: d, endsAt: new Date(d.getTime() + 60 * 60000),
        reason: pick(['Lunch break', 'Staff meeting', 'Personal appointment']),
      });
      blockedCount++;
    }
  }
  console.log(`  ${availCount} availability windows, ${blockedCount} blocked-time entries`);

  // ── 8. Pending public registrations ──────────────────────────────────────────
  console.log('Creating pending registrations…');
  const FIRST = ['Harry', 'Aisha', 'Leo', 'Maya', 'Finn', 'Zara'];
  const LAST = ['O\'Connor', 'Reid', 'Adeyemi', 'Lindqvist', 'Hassan', 'Park'];
  const INSTR_PAIRS: { instrument: string; lessonType: 'private' | 'group' }[][] = [
    [{ instrument: 'piano', lessonType: 'private' }],
    [{ instrument: 'guitar', lessonType: 'private' }, { instrument: 'ukulele', lessonType: 'group' }],
    [{ instrument: 'violin', lessonType: 'private' }],
    [{ instrument: 'drums', lessonType: 'private' }],
  ];
  let regCount = 0;
  for (let i = 0; i < 6; i++) {
    const firstName = pick(FIRST), lastName = pick(LAST);
    const contactFirst = pick(FIRST), contactLast = pick(LAST);
    const status = i < 3 ? 'pending' : pick(['approved', 'denied'] as const);
    await db.insert(registrations).values({
      organizationId: orgId,
      payload: {
        studentFirstName: firstName, studentLastName: lastName,
        familyName: `${contactFirst} ${contactLast}`, contactName: `${contactFirst} ${contactLast}`,
        contactEmail: `${contactFirst.toLowerCase()}.${contactLast.toLowerCase()}@example.com`,
        contactPhone: `07${randInt(700000000, 999999999)}`,
        instruments: pick(INSTR_PAIRS),
        notes: pick(['Found us via Google.', 'Referred by a friend.', '']),
      },
      status,
      decidedAt: status === 'pending' ? undefined : new Date(),
      idempotencyKey: `seed-extra-reg-${i}`,
    }).onConflictDoNothing();
    regCount++;
  }
  console.log(`  ${regCount} registrations`);

  console.log('\n✓ Extra seed complete — every module now has demo data.\n');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
