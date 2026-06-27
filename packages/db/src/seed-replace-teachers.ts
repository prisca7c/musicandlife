/**
 * Replaces the 15 fake demo teachers with the studio's real 5-person roster,
 * reassigning every enrollment/lesson/assignment/availability/payroll/expense
 * row from the old teachers to the new ones (round-robin) before deleting
 * the old staff_members rows.
 * Run with: pnpm --filter @music-life/db seed:teachers
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { eq, and, inArray } from 'drizzle-orm';
import { hash } from 'argon2';
import {
  createDb, organizations, users, memberships,
  staffMembers, staffPrivileges, enrollments, lessons, teacherAssignments,
  availability, blockedTime, payrollRuns, expenses,
} from './index';
import { DEFAULT_TEACHER_PRIVILEGES } from '@music-life/types';

const db = createDb(process.env.DATABASE_URL!);
const TEACHER_PASSWORD = 'Teacher123!';

const ROSTER = [
  { firstName: 'Chen', lastName: 'Wang', instruments: ['piano', 'violin'], hourlyRate: 4500 },
  { firstName: 'Dunni', lastName: 'Oluwayemi', instruments: ['vocal', 'guitar'], hourlyRate: 4200 },
  { firstName: 'Franklin', lastName: 'Tam', instruments: ['guitar', 'bass guitar', 'ukulele'], hourlyRate: 4000 },
  { firstName: 'Orlando', lastName: 'Bonzi', instruments: ['drums', 'guitar'], hourlyRate: 4000 },
  { firstName: 'Yanice', lastName: 'Bonzi', instruments: ['cello', 'viola', 'violin'], hourlyRate: 4500 },
] as const;

async function main() {
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'music-and-life') });
  if (!org) { console.error('Org not found'); process.exit(1); }
  const orgId = org.id;

  const oldTeachers = await db.query.staffMembers.findMany({ where: eq(staffMembers.organizationId, orgId) });
  console.log(`Found ${oldTeachers.length} existing teachers to replace.`);

  console.log('Creating real roster…');
  const newRows = await db.insert(staffMembers).values(
    ROSTER.map(t => ({
      organizationId: orgId, firstName: t.firstName, lastName: t.lastName,
      instruments: [...t.instruments], hourlyRate: t.hourlyRate,
      payrollType: 'hourly' as const, defaultDuration: 60,
    })),
  ).returning();

  for (const t of newRows) {
    await db.insert(staffPrivileges).values({ organizationId: orgId, staffId: t.id, privileges: DEFAULT_TEACHER_PRIVILEGES });
    const firstName = t.firstName.toLowerCase();
    const lastName = t.lastName.toLowerCase();
    const email = `${firstName}.${lastName}@musiclife.test`;
    let userId: string;
    const existingUser = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (existingUser) { userId = existingUser.id; }
    else {
      const ph = await hash(TEACHER_PASSWORD);
      const [u] = await db.insert(users).values({ email, passwordHash: ph, emailVerifiedAt: new Date() }).returning();
      userId = u!.id;
      await db.insert(memberships).values({ userId, organizationId: orgId, baseRole: 'teacher' });
    }
    await db.update(staffMembers).set({ userId }).where(eq(staffMembers.id, t.id));
  }

  // Relink the canonical documented test account to Chen Wang
  const chenWang = newRows.find(t => t.firstName === 'Chen' && t.lastName === 'Wang')!;
  const canonicalUser = await db.query.users.findFirst({ where: eq(users.email, 'teacher@musiclife.test') });
  if (canonicalUser) {
    await db.update(staffMembers).set({ userId: canonicalUser.id }).where(eq(staffMembers.id, chenWang.id));
    console.log('Relinked teacher@musiclife.test -> Chen Wang');
  }

  console.log('Reassigning existing records to new roster (round-robin)…');
  const oldIds = oldTeachers.map(t => t.id);
  if (oldIds.length > 0) {
    let i = 0;
    const nextNewId = () => newRows[i++ % newRows.length]!.id;

    // Reassign per-row so the round-robin is spread evenly rather than collapsing onto one id
    const enrollRows = await db.select({ id: enrollments.id }).from(enrollments).where(inArray(enrollments.teacherId, oldIds));
    for (const row of enrollRows) await db.update(enrollments).set({ teacherId: nextNewId() }).where(eq(enrollments.id, row.id));

    const lessonRows = await db.select({ id: lessons.id }).from(lessons).where(inArray(lessons.teacherId, oldIds));
    for (const row of lessonRows) await db.update(lessons).set({ teacherId: nextNewId() }).where(eq(lessons.id, row.id));

    await db.delete(teacherAssignments).where(inArray(teacherAssignments.staffId, oldIds));
    await db.delete(availability).where(inArray(availability.staffId, oldIds));
    await db.delete(blockedTime).where(inArray(blockedTime.staffId, oldIds));
    await db.update(payrollRuns).set({ staffId: newRows[0]!.id }).where(inArray(payrollRuns.staffId, oldIds));
    await db.update(expenses).set({ staffId: newRows[0]!.id }).where(inArray(expenses.staffId, oldIds));

    console.log(`  Reassigned ${enrollRows.length} enrollments, ${lessonRows.length} lessons.`);

    await db.delete(staffPrivileges).where(inArray(staffPrivileges.staffId, oldIds));
    await db.delete(staffMembers).where(inArray(staffMembers.id, oldIds));
    console.log(`  Deleted ${oldIds.length} old teacher rows.`);
  }

  console.log('\n✓ Roster replaced:');
  for (const t of newRows) console.log(`  ${t.firstName} ${t.lastName} — ${t.firstName.toLowerCase()}.${t.lastName.toLowerCase()}@musiclife.test / ${TEACHER_PASSWORD}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
