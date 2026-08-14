// Adds three named test accounts requested for manual QA of the booking/
// messaging flow: a teacher, a guardian, and their student, linked as one
// family so the parent/student portals can be exercised against a real
// teacher assignment. Idempotent — safe to re-run.
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { eq, and } from 'drizzle-orm';
import { hash } from 'argon2';
import {
  createDb, organizations, users, memberships,
  families, guardians, students, staffMembers, staffPrivileges,
} from '../src/index';
import { DEFAULT_TEACHER_PRIVILEGES } from '@music-life/types';

const db = createDb(process.env.DATABASE_URL!);
const PASSWORD = 'asdf';

const TEACHER_EMAIL = 'anthonychien@gmail.com';
const STUDENT_EMAIL = 'manameizhallo@gmail.com';
const PARENT_EMAIL = 'meiyiutsang@gmail.com';

async function ensureUser(email: string) {
  const passwordHash = await hash(PASSWORD);
  let user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user) {
    const [created] = await db.insert(users).values({ email, passwordHash, emailVerifiedAt: new Date() }).returning();
    user = created!;
  } else {
    await db.update(users).set({ passwordHash, emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
  }
  return user;
}

async function ensureMembership(userId: string, orgId: string, baseRole: 'teacher' | 'guardian' | 'student') {
  const existing = await db.query.memberships.findFirst({
    where: and(eq(memberships.userId, userId), eq(memberships.organizationId, orgId)),
  });
  if (!existing) {
    await db.insert(memberships).values({ userId, organizationId: orgId, baseRole });
  }
}

async function main() {
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'music-and-life') });
  if (!org) throw new Error('Org not found');
  const orgId = org.id;

  // ── Teacher ──────────────────────────────────────────────────────────────
  const teacherUser = await ensureUser(TEACHER_EMAIL);
  await ensureMembership(teacherUser.id, orgId, 'teacher');
  let staff = await db.query.staffMembers.findFirst({
    where: and(eq(staffMembers.userId, teacherUser.id), eq(staffMembers.organizationId, orgId)),
  });
  if (!staff) {
    const [created] = await db.insert(staffMembers).values({
      organizationId: orgId, userId: teacherUser.id,
      firstName: 'Anthony', lastName: 'Chien (TEST)', title: 'Test Teacher',
      status: 'active',
    }).returning();
    staff = created!;
    await db.insert(staffPrivileges).values({ organizationId: orgId, staffId: staff.id, privileges: DEFAULT_TEACHER_PRIVILEGES });
  }

  // ── Family (parent + student) ───────────────────────────────────────────
  let family = await db.query.families.findFirst({
    where: and(eq(families.organizationId, orgId), eq(families.name, 'Chien Test Family (TEST)')),
  });
  if (!family) {
    const [created] = await db.insert(families).values({
      organizationId: orgId, name: 'Chien Test Family (TEST)', contactName: 'Mei Yiu Tsang (TEST)',
    }).returning();
    family = created!;
  }

  const parentUser = await ensureUser(PARENT_EMAIL);
  await ensureMembership(parentUser.id, orgId, 'guardian');
  const existingGuardian = await db.query.guardians.findFirst({
    where: and(eq(guardians.familyId, family.id), eq(guardians.userId, parentUser.id)),
  });
  if (!existingGuardian) {
    await db.insert(guardians).values({ organizationId: orgId, familyId: family.id, userId: parentUser.id, relationship: 'guardian' });
  }

  const studentUser = await ensureUser(STUDENT_EMAIL);
  await ensureMembership(studentUser.id, orgId, 'student');
  let student = await db.query.students.findFirst({
    where: and(eq(students.organizationId, orgId), eq(students.familyId, family.id), eq(students.studentUserId, studentUser.id)),
  });
  if (!student) {
    await db.insert(students).values({
      organizationId: orgId, familyId: family.id,
      firstName: 'Mana', lastName: 'Meizhallo (TEST)',
      status: 'active', studentUserId: studentUser.id,
    });
  }

  console.log('✓ Test accounts ready (all password: asdf):');
  console.log(`  Teacher: ${TEACHER_EMAIL}`);
  console.log(`  Parent:  ${PARENT_EMAIL}`);
  console.log(`  Student: ${STUDENT_EMAIL}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
