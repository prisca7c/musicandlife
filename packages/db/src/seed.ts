import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { eq, and } from 'drizzle-orm';
import {
  createDb, organizations, users, memberships,
  rooms, terms, families, students,
  staffMembers, staffPrivileges, teacherAssignments, enrollments,
} from './index';
import { hash } from 'argon2';
import { DEFAULT_TEACHER_PRIVILEGES } from '../../types/src/index';

const db = createDb(process.env.DATABASE_URL!);

async function seed() {
  console.log('Seeding database…');

  // ── Org ──────────────────────────────────────────────────────────────────────
  await db.insert(organizations)
    .values({ name: 'Music & Life', slug: 'music-and-life', timezone: 'Europe/London', currency: 'GBP', country: 'GB' })
    .onConflictDoNothing();

  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'music-and-life') });
  if (!org) { console.error('Could not find org'); process.exit(1); }
  const orgId = org.id;

  // ── Admin user ───────────────────────────────────────────────────────────────
  const adminEmail = process.env.SEED_ADMIN_EMAIL!;
  const adminHash = await hash(process.env.SEED_ADMIN_PASSWORD!);
  const [admin] = await db
    .insert(users)
    .values({ email: adminEmail, passwordHash: adminHash, emailVerifiedAt: new Date() })
    .onConflictDoNothing()
    .returning();
  if (admin) {
    await db.insert(memberships).values({ userId: admin.id, organizationId: orgId, baseRole: 'admin' }).onConflictDoNothing();
  }

  // ── Rooms (5) ────────────────────────────────────────────────────────────────
  for (const name of ['Room 1', 'Room 2', 'Room 3', 'Room 4', 'Room 5']) {
    await db.insert(rooms).values({ organizationId: orgId, name, capacity: 2 }).onConflictDoNothing();
  }

  // ── 2025-26 Terms (T&Cs §5 — 35 lessons total) ───────────────────────────────
  const termDefs = [
    { name: 'Autumn Term 2025', startsOn: '2025-09-15', endsOn: '2025-12-13', weekCount: 12, status: 'closed' as const },
    { name: 'Spring Term 2026', startsOn: '2026-01-05', endsOn: '2026-03-28', weekCount: 11, status: 'closed' as const },
    { name: 'Summer Term 2026', startsOn: '2026-04-13', endsOn: '2026-07-11', weekCount: 12, status: 'active' as const },
  ];
  for (const td of termDefs) {
    await db.insert(terms).values({ ...td, organizationId: orgId }).onConflictDoNothing();
  }
  const activeTerm = await db.query.terms.findFirst({
    where: and(eq(terms.organizationId, orgId), eq(terms.status, 'active')),
  });

  // ── Staff teachers ────────────────────────────────────────────────────────────
  const teacherDefs = [
    { firstName: 'Sarah', lastName: 'Mitchell', instruments: ['piano', 'violin'], hourlyRate: 4500 },
    { firstName: 'James', lastName: 'Carter',   instruments: ['guitar', 'bass', 'drums'],  hourlyRate: 4000 },
    { firstName: 'Mei',   lastName: 'Chen',     instruments: ['violin', 'viola', 'cello'], hourlyRate: 4500 },
  ];
  const staffIds: string[] = [];
  for (const t of teacherDefs) {
    const [sm] = await db.insert(staffMembers)
      .values({ ...t, organizationId: orgId, payrollType: 'hourly', defaultDuration: 60 })
      .returning();
    await db.insert(staffPrivileges)
      .values({ organizationId: orgId, staffId: sm!.id, privileges: DEFAULT_TEACHER_PRIVILEGES })
      .onConflictDoNothing();
    staffIds.push(sm!.id);
  }
  const [sarahId, jamesId, meiId] = staffIds as [string, string, string];

  // ── Families & students ───────────────────────────────────────────────────────
  const familyDefs = [
    { name: 'Johnson Family', contactName: 'Claire Johnson', email: 'claire@example.com', phone: '07700 900001', students: [
      { firstName: 'Oliver', lastName: 'Johnson', dob: '2012-03-15', instrument: 'piano',  teacherId: sarahId },
      { firstName: 'Emma',   lastName: 'Johnson', dob: '2014-07-22', instrument: 'violin', teacherId: meiId },
    ]},
    { name: 'Smith Family', contactName: 'David Smith', email: 'david@example.com', phone: '07700 900002', students: [
      { firstName: 'Liam',  lastName: 'Smith', dob: '2011-09-05', instrument: 'guitar', teacherId: jamesId },
      { firstName: 'Grace', lastName: 'Smith', dob: '2015-01-18', instrument: 'piano',  teacherId: sarahId },
    ]},
    { name: 'Patel Family', contactName: 'Priya Patel', email: 'priya@example.com', phone: '07700 900003', students: [
      { firstName: 'Arjun', lastName: 'Patel', dob: '2013-06-30', instrument: 'drums',  teacherId: jamesId },
      { firstName: 'Anika', lastName: 'Patel', dob: '2016-11-10', instrument: 'violin', teacherId: meiId },
    ]},
    { name: 'Williams Family', contactName: 'Tom Williams', email: 'tom@example.com', phone: '07700 900004', students: [
      { firstName: 'Sophia', lastName: 'Williams', dob: '2010-04-12', instrument: 'cello', teacherId: meiId },
    ]},
    { name: 'Brown Family', contactName: 'Rachel Brown', email: 'rachel@example.com', phone: '07700 900005', students: [
      { firstName: 'Noah', lastName: 'Brown', dob: '2014-08-25', instrument: 'guitar', teacherId: jamesId },
    ]},
  ];

  for (const fd of familyDefs) {
    const { students: studentDefs, ...familyData } = fd;
    const [fam] = await db.insert(families)
      .values({ ...familyData, organizationId: orgId })
      .returning();

    for (const sd of studentDefs) {
      const { instrument, teacherId, ...studentData } = sd;
      const [student] = await db.insert(students)
        .values({ ...studentData, organizationId: orgId, familyId: fam!.id, status: 'active' })
        .returning();

      await db.insert(teacherAssignments)
        .values({ organizationId: orgId, staffId: teacherId, studentId: student!.id, role: 'primary' })
        .onConflictDoNothing();

      if (activeTerm) {
        await db.insert(enrollments).values({
          organizationId: orgId,
          studentId: student!.id,
          termId: activeTerm.id,
          instrument,
          lessonType: 'private',
          teacherId,
          rate: 7000, // £70 for 60-min private lesson per T&Cs §1
          scheduleRule: { weekday: 'monday', startTime: '16:00' },
          autoRenew: true,
          status: 'active',
        });
      }
    }
  }

  console.log('Seed complete ✓');
  process.exit(0);
}

seed().catch((err) => { console.error(err); process.exit(1); });
