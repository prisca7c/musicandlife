/**
 * Bulk demo-data seed: 200 students, 28 waitlist leads, and supporting
 * records across every module so the app is fully populated end-to-end.
 * Run with: pnpm --filter @music-life/db seed:bulk
 *
 * All generated guardian/teacher portal logins share one password per role
 * (printed at the end) so they're easy to test across portals.
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { eq, and } from 'drizzle-orm';
import { hash } from 'argon2';
import {
  createDb,
  organizations, users, memberships,
  staffMembers, staffPrivileges, families, guardians, students, enrollments,
  terms, rooms, lessons, attendance, invoices, invoiceLineItems, payments,
  ledgerEntries, lessonCredits, leads, resources, threads, threadParticipants,
  messages, notes,
} from './index';
import { DEFAULT_TEACHER_PRIVILEGES } from '@music-life/types';

const db = createDb(process.env.DATABASE_URL!);

const TEACHER_PASSWORD = 'Teacher123!';
const GUARDIAN_PASSWORD = 'Family123!';

// ─── Name pools ─────────────────────────────────────────────────────────────
const BOY_NAMES = ['Oliver','Jack','George','Noah','Charlie','Jacob','Leo','Oscar','Freddie','Archie','Theo','Henry','Arthur','Joshua','Alfie','William','Thomas','Joseph','James','Logan','Edward','Samuel','Max','Lucas','Daniel','Isaac','Reuben','Toby','Finley','Hugo'];
const GIRL_NAMES = ['Olivia','Amelia','Isla','Ava','Ivy','Freya','Lily','Florence','Mia','Willow','Sophia','Grace','Evie','Poppy','Charlotte','Emily','Elsie','Daisy','Alice','Rosie','Phoebe','Matilda','Sienna','Ruby','Eva','Maya','Layla','Nina','Clara','Esme'];
const LAST_NAMES = ['Smith','Jones','Williams','Brown','Taylor','Davies','Wilson','Evans','Thomas','Roberts','Walker','Wright','Robinson','Green','Hall','Wood','Patel','Khan','Hughes','Edwards','Hill','Moore','Clarke','Baker','Turner','Phillips','Mitchell','Carter','King','Ahmed','Bennett','Cooper','Murphy','Bell','Fisher','Russell','Ward','Stevens','Foster','Shaw'];
const TEACHER_FIRST = ['Sophie','Daniel','Hannah','Ryan','Lucy','Adam','Emily','Mark','Chloe','Ben','Holly','Tom'];
const TEACHER_LAST = ['Whitfield','Osei','Marsh','Donnelly','Hartley','Iqbal','Pearce','Sandhu','Ferris','Nakamura','Holloway','Quinn'];
const STREETS = ['High Street','Church Road','Station Approach','Pinner Green','Cecil Park','Marsh Road','Bridge Street','Love Lane','Westfield Park','Nower Hill','Elm Park Road','George V Avenue'];

let seed = 42;
function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function pick<T>(arr: readonly T[]): T { return arr[Math.floor(rand() * arr.length)]!; }
function randInt(min: number, max: number) { return min + Math.floor(rand() * (max - min + 1)); }
function shuffle<T>(arr: T[]): T[] { return arr.map(a => [rand(), a] as const).sort((a, b) => a[0] - b[0]).map(a => a[1]); }

const PRIVATE_INSTR = ['guitar','piano','violin','drums','bass guitar','cello','viola','vocal'] as const;
const GROUP_INSTR = ['guitar','ukulele','suzuki violin','ensemble'] as const;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function dateStr(d: Date) { return d.toISOString().split('T')[0]!; }
function isoAt(base: Date, weekOffset: number, weekday: number, hour: number, minute: number) {
  const d = new Date(base);
  const day = d.getDay();
  d.setDate(d.getDate() - ((day === 0 ? 7 : day) - 1) + weekOffset * 7 + (weekday - 1));
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function main() {
  console.log('Starting bulk seed…\n');

  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'music-and-life') });
  if (!org) { console.error('Org not found — run `pnpm --filter @music-life/db seed` first'); process.exit(1); }
  const orgId = org.id;

  const activeTerm = await db.query.terms.findFirst({ where: and(eq(terms.organizationId, orgId), eq(terms.status, 'active')) });
  const existingTeachers = await db.query.staffMembers.findMany({ where: eq(staffMembers.organizationId, orgId) });
  const existingRooms = await db.query.rooms.findMany({ where: eq(rooms.organizationId, orgId) });

  // ── 1. More teaching staff (existing 3 + 9 new = 12) ─────────────────────────
  console.log('Creating teaching staff…');
  const newTeacherRows = TEACHER_FIRST.map((firstName, i) => ({
    organizationId: orgId,
    firstName,
    lastName: TEACHER_LAST[i]!,
    instruments: shuffle([...PRIVATE_INSTR]).slice(0, randInt(1, 3)) as string[],
    hourlyRate: pick([3800, 4000, 4200, 4500, 5000]),
    payrollType: 'hourly' as const,
    defaultDuration: 60,
  }));
  const insertedTeachers = await db.insert(staffMembers).values(newTeacherRows).returning();
  for (const t of insertedTeachers) {
    await db.insert(staffPrivileges).values({ organizationId: orgId, staffId: t.id, privileges: DEFAULT_TEACHER_PRIVILEGES });
  }
  const allTeachers = [...existingTeachers, ...insertedTeachers];

  // Portal logins for the new teachers (existing 3 already have/may not have logins)
  for (const t of insertedTeachers) {
    const email = `${t.firstName.toLowerCase()}.${t.lastName.toLowerCase()}@musiclife.test`;
    const existingUser = await db.query.users.findFirst({ where: eq(users.email, email) });
    let userId: string;
    if (existingUser) { userId = existingUser.id; }
    else {
      const ph = await hash(TEACHER_PASSWORD);
      const [u] = await db.insert(users).values({ email, passwordHash: ph, emailVerifiedAt: new Date() }).returning();
      userId = u!.id;
      await db.insert(memberships).values({ userId, organizationId: orgId, baseRole: 'teacher' });
    }
    await db.update(staffMembers).set({ userId }).where(eq(staffMembers.id, t.id));
  }

  // ── 2. More rooms ─────────────────────────────────────────────────────────────
  if (existingRooms.length < 8) {
    const need = 8 - existingRooms.length;
    await db.insert(rooms).values(
      Array.from({ length: need }, (_, i) => ({ organizationId: orgId, name: `Room ${existingRooms.length + i + 1}`, capacity: 2 })),
    );
  }
  const allRooms = await db.query.rooms.findMany({ where: eq(rooms.organizationId, orgId) });

  // ── 3. Families + students (200 students across ~140 families) ──────────────
  console.log('Creating families and students…');
  const familyPlans: { studentCount: 1 | 2 }[] = [];
  let studentsLeft = 200;
  while (studentsLeft > 0) {
    const n = (studentsLeft >= 2 && rand() < 0.45) ? 2 : 1;
    familyPlans.push({ studentCount: Math.min(n, studentsLeft) as 1 | 2 });
    studentsLeft -= n;
  }

  const familyLastNames: string[] = [];
  const familyRows = familyPlans.map((_, i) => {
    const lastName = pick(LAST_NAMES);
    const contactFirst = pick([...BOY_NAMES, ...GIRL_NAMES]);
    familyLastNames.push(lastName);
    return {
      organizationId: orgId,
      name: `${contactFirst} ${lastName}`,
      contactName: `${contactFirst} ${lastName}`,
      email: `${contactFirst.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`,
      phone: `07${randInt(700000000, 999999999)}`,
      address: `${randInt(1, 180)} ${pick(STREETS)}, Pinner, HA5 ${randInt(1, 9)}${pick(['AB','CD','EF','GH','JK'])}`,
      invoiceMode: 'monthly_statement' as const,
    };
  });
  const insertedFamilies = await db.insert(families).values(familyRows).returning();

  const studentRows: { familyId: string; firstName: string; lastName: string; dob: string; status: 'trial' | 'active' | 'paused' | 'withdrawn'; lastName2: string }[] = [];
  for (let i = 0; i < insertedFamilies.length; i++) {
    const fam = insertedFamilies[i]!;
    const lastName = familyLastNames[i]!;
    const count = familyPlans[i]!.studentCount;
    for (let s = 0; s < count; s++) {
      const isGirl = rand() < 0.5;
      const firstName = pick(isGirl ? GIRL_NAMES : BOY_NAMES);
      const age = randInt(5, 17);
      const dobYear = 2026 - age;
      const r = rand();
      const status: 'trial' | 'active' | 'paused' | 'withdrawn' = r < 0.08 ? 'trial' : r < 0.85 ? 'active' : r < 0.94 ? 'paused' : 'withdrawn';
      studentRows.push({
        familyId: fam.id, firstName, lastName, lastName2: lastName,
        dob: `${dobYear}-${String(randInt(1, 12)).padStart(2, '0')}-${String(randInt(1, 28)).padStart(2, '0')}`,
        status,
      });
    }
  }

  const studentInsertRows = studentRows.map(s => ({
    organizationId: orgId, familyId: s.familyId, firstName: s.firstName, lastName: s.lastName,
    dob: s.dob, status: s.status,
  }));
  const insertedStudents: { id: string; familyId: string; firstName: string; lastName: string; status: string }[] = [];
  for (const c of chunk(studentInsertRows, 100)) {
    insertedStudents.push(...await db.insert(students).values(c).returning());
  }
  console.log(`  ${insertedFamilies.length} families, ${insertedStudents.length} students`);

  // ── 4. Guardian portal logins for the first 15 families ──────────────────────
  console.log('Creating guardian portal logins…');
  const loginFamilies = insertedFamilies.slice(0, 15);
  for (const fam of loginFamilies) {
    const email = fam.email!;
    const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
    let userId: string;
    if (existing) { userId = existing.id; }
    else {
      const ph = await hash(GUARDIAN_PASSWORD);
      const [u] = await db.insert(users).values({ email, passwordHash: ph, emailVerifiedAt: new Date() }).returning();
      userId = u!.id;
      await db.insert(memberships).values({ userId, organizationId: orgId, baseRole: 'guardian' });
    }
    await db.insert(guardians).values({ organizationId: orgId, familyId: fam.id, userId, relationship: 'parent' }).onConflictDoNothing();
  }

  // ── 5. Enrollments ────────────────────────────────────────────────────────────
  console.log('Creating enrollments…');
  const enrollable = insertedStudents.filter(s => s.status === 'active' || s.status === 'trial');
  const enrollmentRows: { studentId: string; termId: string | null; instrument: string; lessonType: 'private' | 'group'; groupName?: string; teacherId: string; rate: number; status: 'trial' | 'active'; autoRenew: boolean; scheduleRule: { weekday: string; startTime: string } }[] = [];
  const WEEKDAY_NAMES = ['monday','tuesday','wednesday','thursday','friday','saturday'];
  const RATE_PRIVATE: Record<number, number> = { 30: 3500, 45: 5250, 60: 7000 };
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const fmtSlot = (weekday: string, startTime: string) => {
    const [h, m] = startTime.split(':').map(Number) as [number, number];
    const period = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${cap(weekday)} ${h12}${m ? `:${String(m).padStart(2, '0')}` : ''}${period}`;
  };

  for (const stu of enrollable) {
    const numEnrollments = rand() < 0.18 ? 2 : 1;
    for (let e = 0; e < numEnrollments; e++) {
      const isGroup = rand() < 0.2;
      const instrument = isGroup ? pick(GROUP_INSTR) : pick(PRIVATE_INSTR);
      const teacher = pick(allTeachers);
      const duration = isGroup ? 60 : pick([30, 45, 60]);
      const rate = isGroup ? 2500 : RATE_PRIVATE[duration]!;
      const scheduleRule = { weekday: pick(WEEKDAY_NAMES), startTime: `${randInt(14, 18)}:${pick(['00', '30'])}` };
      enrollmentRows.push({
        studentId: stu.id,
        termId: activeTerm?.id ?? null,
        instrument,
        lessonType: isGroup ? 'group' : 'private',
        groupName: isGroup ? `${fmtSlot(scheduleRule.weekday, scheduleRule.startTime)} ${cap(instrument)}` : undefined,
        teacherId: teacher.id,
        rate,
        status: stu.status === 'trial' ? 'trial' : 'active',
        autoRenew: true,
        scheduleRule,
      });
    }
  }
  const enrollmentInsertRows = enrollmentRows.map(e => ({
    organizationId: orgId, studentId: e.studentId, termId: e.termId ?? undefined, instrument: e.instrument,
    lessonType: e.lessonType, groupName: e.groupName, teacherId: e.teacherId, rate: e.rate, status: e.status, autoRenew: e.autoRenew,
    scheduleRule: e.scheduleRule,
  }));
  const insertedEnrollments: { id: string; studentId: string; teacherId: string | null; instrument: string; lessonType: string; rate: number; scheduleRule: unknown; status: string }[] = [];
  for (const c of chunk(enrollmentInsertRows, 100)) {
    insertedEnrollments.push(...await db.insert(enrollments).values(c).returning());
  }
  console.log(`  ${insertedEnrollments.length} enrollments`);

  // ── 6. Lessons + attendance (3 weeks back, this week, 1 week ahead) ──────────
  console.log('Creating lessons + attendance…');
  const now = new Date();
  const lessonRows: { id?: string; enrollmentId: string; studentId: string; teacherId: string | null; roomId: string; startsAt: Date; duration: number; status: string; termId: string | null }[] = [];

  for (const en of insertedEnrollments) {
    const rule = en.scheduleRule as { weekday: string; startTime: string };
    const weekdayIdx = WEEKDAY_NAMES.indexOf(rule.weekday) + 1; // 1=mon
    const [h, m] = rule.startTime.split(':').map(Number) as [number, number];
    const duration = en.lessonType === 'group' ? 60 : pick([30, 45, 60]);
    const room = pick(allRooms);

    for (const weekOffset of [-3, -2, -1, 0, 1]) {
      const startsAt = isoAt(now, weekOffset, weekdayIdx, h, m);
      const isPast = startsAt.getTime() < now.getTime();
      let status = 'scheduled';
      if (isPast) {
        const r = rand();
        status = r < 0.82 ? 'completed' : r < 0.90 ? 'cancelled_no_makeup' : r < 0.96 ? 'cancelled_makeup' : 'cancelled_teacher';
      }
      lessonRows.push({
        enrollmentId: en.id, studentId: en.studentId, teacherId: en.teacherId, roomId: room.id,
        startsAt, duration, status, termId: activeTerm?.id ?? null,
      });
    }
  }

  const lessonInsertRows = lessonRows.map(l => ({
    organizationId: orgId, enrollmentId: l.enrollmentId, studentId: l.studentId,
    teacherId: l.teacherId ?? undefined, roomId: l.roomId, startsAt: l.startsAt, duration: l.duration,
    status: l.status as 'scheduled' | 'completed' | 'cancelled_no_makeup' | 'cancelled_makeup' | 'cancelled_teacher',
    termId: l.termId ?? undefined,
  }));
  const insertedLessons: { id: string; status: string }[] = [];
  for (const c of chunk(lessonInsertRows, 200)) {
    insertedLessons.push(...await db.insert(lessons).values(c).returning({ id: lessons.id, status: lessons.status }));
  }
  // INSERT ... RETURNING preserves row order, so this zips 1:1 back onto the in-memory rows
  lessonRows.forEach((l, i) => { l.id = insertedLessons[i]!.id; });
  console.log(`  ${insertedLessons.length} lessons`);

  const attendanceRows: { lessonId: string; status: string }[] = [];
  for (const l of insertedLessons) {
    if (l.status === 'completed') attendanceRows.push({ lessonId: l.id, status: 'present' });
    else if (l.status === 'cancelled_no_makeup') attendanceRows.push({ lessonId: l.id, status: 'absent_no_makeup' });
    else if (l.status === 'cancelled_makeup') attendanceRows.push({ lessonId: l.id, status: 'absent_makeup' });
    else if (l.status === 'cancelled_teacher') attendanceRows.push({ lessonId: l.id, status: 'cancelled_teacher' });
  }
  const attendanceInsertRows = attendanceRows.map(a => ({
    organizationId: orgId, lessonId: a.lessonId,
    status: a.status as 'present' | 'absent_makeup' | 'absent_no_makeup' | 'cancelled_teacher',
  }));
  for (const c of chunk(attendanceInsertRows, 200)) {
    await db.insert(attendance).values(c);
  }
  console.log(`  ${attendanceInsertRows.length} attendance records`);

  // ── 7. Invoices + line items + payments per family ───────────────────────────
  console.log('Creating invoices, payments, ledger entries…');
  const enrollByStudent = new Map<string, typeof insertedEnrollments>();
  for (const en of insertedEnrollments) {
    const arr = enrollByStudent.get(en.studentId) ?? [];
    arr.push(en); enrollByStudent.set(en.studentId, arr);
  }
  const studentsByFamily = new Map<string, typeof insertedStudents>();
  for (const s of insertedStudents) {
    const arr = studentsByFamily.get(s.familyId) ?? [];
    arr.push(s); studentsByFamily.set(s.familyId, arr);
  }
  const lessonsByEnrollment = new Map<string, typeof lessonRows>();
  for (const l of lessonRows) {
    const arr = lessonsByEnrollment.get(l.enrollmentId) ?? [];
    arr.push(l); lessonsByEnrollment.set(l.enrollmentId, arr);
  }

  let invoiceNum = 1;
  const today = dateStr(now);
  const due = dateStr(new Date(now.getTime() + 7 * 86400000));
  let billedFamilies = 0;

  for (const fam of insertedFamilies) {
    const famStudents = studentsByFamily.get(fam.id) ?? [];
    const lineItemDefs: { lessonId: string; description: string; amount: number; date: Date }[] = [];
    for (const stu of famStudents) {
      for (const en of enrollByStudent.get(stu.id) ?? []) {
        const enLessons = lessonsByEnrollment.get(en.id) ?? [];
        for (const lesson of enLessons) {
          if (lesson.status !== 'completed' || !lesson.id) continue;
          lineItemDefs.push({
            lessonId: lesson.id,
            description: `${lesson.duration} min lesson`,
            amount: en.rate,
            date: lesson.startsAt,
          });
        }
      }
    }
    if (lineItemDefs.length === 0) continue;
    lineItemDefs.sort((a, b) => a.date.getTime() - b.date.getTime());
    billedFamilies++;
    const total = lineItemDefs.reduce((s, l) => s + l.amount, 0);
    const r = rand();
    const status: 'draft' | 'sent' | 'paid' = r < 0.6 ? 'paid' : r < 0.9 ? 'sent' : 'draft';

    const [inv] = await db.insert(invoices).values({
      organizationId: orgId, familyId: fam.id, mode: 'monthly_statement', termId: activeTerm?.id,
      number: `INV-${String(invoiceNum++).padStart(4, '0')}`, issuedOn: today, dueDate: due, status, total,
    }).returning();

    await db.insert(invoiceLineItems).values(
      lineItemDefs.map(l => ({ organizationId: orgId, invoiceId: inv!.id, lessonId: l.lessonId, description: l.description, amount: l.amount })),
    );

    if (status === 'paid') {
      const method = pick(['bank_transfer', 'bank_transfer', 'card', 'cash'] as const);
      await db.insert(payments).values({
        organizationId: orgId, familyId: fam.id, invoiceId: inv!.id, method, amount: total,
        idempotencyKey: `seed-${inv!.id}`,
      });
      await db.insert(ledgerEntries).values({
        organizationId: orgId, familyId: fam.id, type: 'payment', amount: total, balanceAfter: 0,
        invoiceId: inv!.id, description: `Payment received for ${inv!.number}`,
      });
    } else if (status === 'sent') {
      await db.insert(ledgerEntries).values({
        organizationId: orgId, familyId: fam.id, type: 'charge', amount: total, balanceAfter: total,
        invoiceId: inv!.id, description: `Invoice ${inv!.number} issued`,
      });
    }
  }
  console.log(`  ${billedFamilies} invoices`);

  // ── 8. Lesson credits (prepaid pool) for ~30% of active students ────────────
  console.log('Creating lesson credit balances…');
  const creditRows: { studentId: string; type: 'prepaid'; status: 'available' }[] = [];
  for (const stu of enrollable) {
    if (rand() < 0.3) {
      const n = randInt(1, 4);
      for (let i = 0; i < n; i++) creditRows.push({ studentId: stu.id, type: 'prepaid', status: 'available' });
    }
  }
  for (const c of chunk(creditRows.map(c => ({ organizationId: orgId, studentId: c.studentId, type: c.type, status: c.status })), 200)) {
    await db.insert(lessonCredits).values(c);
  }
  console.log(`  ${creditRows.length} lesson credits`);

  // ── 9. Waitlist leads (28) ─────────────────────────────────────────────────────
  console.log('Creating waitlist leads…');
  const leadSources = ['website', 'referral', 'walk-in', 'social media', 'phone'];
  const leadNotes = [
    'Interested in starting lessons after half-term.',
    'Asked about sibling discount for two children.',
    'Wants a trial lesson before committing to a term.',
    'Following up next week — currently deciding between piano and guitar.',
    'Referred by an existing family, very keen to start soon.',
    'Asked about group ensemble availability on weekends.',
    'Needs evening slots only due to school schedule.',
    '',
  ];
  const leadRows = Array.from({ length: 28 }, () => {
    const isGirl = rand() < 0.5;
    const firstName = pick(isGirl ? GIRL_NAMES : BOY_NAMES);
    const lastName = pick(LAST_NAMES);
    const r = rand();
    return {
      organizationId: orgId,
      name: `${firstName} ${lastName}`,
      contact: `${firstName.toLowerCase()}.${lastName.toLowerCase()}.parent@example.com`,
      instrumentInterest: pick([...PRIVATE_INSTR, ...GROUP_INSTR]),
      source: pick(leadSources),
      status: (r < 0.75 ? 'new' : r < 0.9 ? 'contacted' : r < 0.96 ? 'converted' : 'lost') as 'new' | 'contacted' | 'converted' | 'lost',
      notes: pick(leadNotes),
    };
  });
  await db.insert(leads).values(leadRows);
  console.log(`  28 waitlist leads`);

  // ── 10. Resources ─────────────────────────────────────────────────────────────
  console.log('Creating resources…');
  const resourceDefs: { title: string; description: string; type: 'link' | 'note'; url?: string; scope: 'studio' | 'teacher' | 'family' }[] = [
    { title: 'Beginner Piano Scales (PDF)', description: 'C, G and D major scales for new piano students.', type: 'link', url: 'https://example.com/piano-scales.pdf', scope: 'family' },
    { title: 'Guitar Chord Chart', description: 'Open chords reference sheet.', type: 'link', url: 'https://example.com/guitar-chords.pdf', scope: 'family' },
    { title: 'Term Dates 2025–26', description: 'Studio term calendar and inset days.', type: 'note', scope: 'studio' },
    { title: 'Practice Log Template', description: 'Printable weekly practice tracker for students.', type: 'link', url: 'https://example.com/practice-log.pdf', scope: 'family' },
    { title: 'Violin Posture Guide', description: 'Photos and tips for correct bow hold and posture.', type: 'link', url: 'https://example.com/violin-posture.pdf', scope: 'family' },
    { title: 'Teacher Lesson Plan Template', description: 'Standard lesson plan format for new teachers.', type: 'note', scope: 'teacher' },
    { title: 'Exam Board Syllabus Links (ABRSM/Trinity)', description: 'Quick links to current grade syllabi.', type: 'link', url: 'https://example.com/syllabus', scope: 'teacher' },
    { title: 'Studio Health & Safety Policy', description: 'Internal H&S policy document.', type: 'note', scope: 'teacher' },
    { title: 'Recital Programme Template', description: 'Editable template for end-of-term recitals.', type: 'link', url: 'https://example.com/recital-template.docx', scope: 'studio' },
    { title: 'Music Theory Basics', description: 'Intro to notation, rhythm and key signatures.', type: 'link', url: 'https://example.com/theory-basics.pdf', scope: 'family' },
    { title: 'Drum Rudiments Sheet', description: 'Core rudiments for beginner–intermediate drummers.', type: 'link', url: 'https://example.com/drum-rudiments.pdf', scope: 'family' },
    { title: 'Ensemble Repertoire List — Summer Term', description: 'Pieces selected for the group ensemble this term.', type: 'note', scope: 'teacher' },
  ];
  await db.insert(resources).values(resourceDefs.map(r => ({ organizationId: orgId, title: r.title, description: r.description, type: r.type, url: r.url, scope: r.scope })));
  console.log(`  ${resourceDefs.length} resources`);

  // ── 11. Messaging threads ─────────────────────────────────────────────────────
  console.log('Creating message threads…');
  const adminUser = await db.query.users.findFirst({
    where: eq(users.email, process.env.SEED_ADMIN_EMAIL!),
  });
  const loginGuardianUsers = await db.query.guardians.findMany({
    where: eq(guardians.organizationId, orgId),
    with: { user: true, family: true },
    limit: 10,
  });
  const threadSubjects = [
    'Lesson time change request', 'Half-term schedule', 'Recital sign-up', 'Question about invoice',
    'Makeup lesson availability', 'Instrument upgrade advice', 'Practice tips request', 'Term renewal',
  ];
  if (adminUser) {
    for (let i = 0; i < Math.min(8, loginGuardianUsers.length); i++) {
      const g = loginGuardianUsers[i]!;
      const [th] = await db.insert(threads).values({
        organizationId: orgId, subject: threadSubjects[i % threadSubjects.length]!, createdBy: g.userId,
      }).returning();
      await db.insert(threadParticipants).values([
        { threadId: th!.id, userId: g.userId },
        { threadId: th!.id, userId: adminUser.id },
      ]);
      await db.insert(messages).values([
        { organizationId: orgId, threadId: th!.id, senderId: g.userId, body: 'Hi, just wanted to check in about this — could you let me know when you have a moment?' },
        { organizationId: orgId, threadId: th!.id, senderId: adminUser.id, body: 'Thanks for reaching out! Let me look into this and get back to you shortly.' },
      ]);
    }
  }
  console.log('  message threads created');

  // ── 12. Lesson notes ───────────────────────────────────────────────────────────
  console.log('Creating lesson notes…');
  const noteBodies = [
    'Great progress on scales this week — ready to move to the next grade piece.',
    'Struggling a little with rhythm in the new piece, recommended slow practice with metronome.',
    'Lovely improvement in bow control. Keep practicing long tones.',
    'Missed last week\'s assignment — please remind at home about daily practice.',
    'Excellent recital preparation, very confident performance.',
    'Introduced a new technique book this week — see attached resource list.',
    'Good session, slightly distracted today — worth a short break next time before lesson.',
    'Ready to start preparing for the grade exam next term.',
  ];
  const sampleStudents = shuffle(insertedStudents.filter(s => s.status === 'active')).slice(0, 30);
  for (const stu of sampleStudents) {
    const en = (enrollByStudent.get(stu.id) ?? [])[0];
    const teacherId = en?.teacherId;
    const teacher = teacherId ? allTeachers.find(t => t.id === teacherId) : undefined;
    const authorUser = teacher?.userId
      ? teacher.userId
      : adminUser?.id;
    if (!authorUser) continue;
    await db.insert(notes).values({
      organizationId: orgId, studentId: stu.id, authorId: authorUser,
      body: pick(noteBodies), visibility: pick(['family', 'family', 'internal'] as const),
    });
  }
  console.log(`  ${sampleStudents.length} lesson notes`);

  console.log('\n✓ Bulk seed complete!\n');
  console.log(`  ${insertedFamilies.length} families · ${insertedStudents.length} students · ${insertedEnrollments.length} enrollments`);
  console.log(`  ${allTeachers.length} teachers · ${insertedLessons.length} lessons · ${billedFamilies} invoices · 28 waitlist leads\n`);
  console.log('  Sample guardian logins (15 created), password: ' + GUARDIAN_PASSWORD);
  for (const fam of loginFamilies.slice(0, 5)) console.log(`    ${fam.email}`);
  console.log('  All new teacher logins, password: ' + TEACHER_PASSWORD);
  for (const t of insertedTeachers.slice(0, 5)) console.log(`    ${t.firstName.toLowerCase()}.${t.lastName.toLowerCase()}@musiclife.test`);
  console.log('');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
