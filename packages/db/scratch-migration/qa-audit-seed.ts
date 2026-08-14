// Phase-1 QA/security audit — provisions two fully isolated families (A, B)
// each with 2 students, plus a fresh teacher and one account at every staff
// role level, all under known passwords, so IDOR/cross-tenant tests can be
// run via the API with real JWTs. Idempotent — safe to re-run.
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { eq, and } from 'drizzle-orm';
import { hash } from 'argon2';
import {
  createDb,
  organizations, users, memberships,
  staffMembers, families, guardians, students,
} from '../src/index';

const db = createDb(process.env.DATABASE_URL!);
const PASS = 'QaAudit123!';

async function upsertUser(email: string) {
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  const ph = await hash(PASS);
  if (existing) {
    await db.update(users).set({ passwordHash: ph, emailVerifiedAt: new Date() }).where(eq(users.id, existing.id));
    return existing.id;
  }
  const [u] = await db.insert(users).values({ email, passwordHash: ph, emailVerifiedAt: new Date() }).returning();
  return u!.id;
}

async function upsertMembership(userId: string, orgId: string, role: string) {
  const existing = await db.query.memberships.findFirst({
    where: and(eq(memberships.userId, userId), eq(memberships.organizationId, orgId)),
  });
  if (!existing) {
    await db.insert(memberships).values({ userId, organizationId: orgId, baseRole: role as never });
  } else if (existing.baseRole !== role) {
    await db.update(memberships).set({ baseRole: role as never }).where(eq(memberships.id, existing.id));
  }
}

async function ensureFamily(orgId: string, name: string, email: string) {
  let fam = await db.query.families.findFirst({ where: and(eq(families.organizationId, orgId), eq(families.name, name)) });
  if (!fam) {
    const [f] = await db.insert(families).values({ organizationId: orgId, name, contactName: name, email }).returning();
    fam = f!;
  }
  return fam;
}

async function ensureStudent(orgId: string, familyId: string, firstName: string, lastName: string) {
  let s = await db.query.students.findFirst({
    where: and(eq(students.organizationId, orgId), eq(students.familyId, familyId), eq(students.firstName, firstName)),
  });
  if (!s) {
    const [created] = await db.insert(students).values({ organizationId: orgId, familyId, firstName, lastName, status: 'active' }).returning();
    s = created!;
  }
  return s;
}

async function ensureStudentLogin(orgId: string, studentId: string, email: string) {
  const uid = await upsertUser(email);
  await upsertMembership(uid, orgId, 'student');
  await db.update(students).set({ studentUserId: uid }).where(eq(students.id, studentId));
  return uid;
}

async function ensureGuardian(orgId: string, familyId: string, email: string) {
  const uid = await upsertUser(email);
  await upsertMembership(uid, orgId, 'guardian');
  const existingG = await db.query.guardians.findFirst({ where: and(eq(guardians.familyId, familyId), eq(guardians.userId, uid)) });
  if (!existingG) {
    await db.insert(guardians).values({ organizationId: orgId, familyId, userId: uid, relationship: 'parent' });
  }
  return uid;
}

async function ensureStaff(orgId: string, email: string, role: string, firstName: string, lastName: string) {
  const uid = await upsertUser(email);
  await upsertMembership(uid, orgId, role);
  let staff = await db.query.staffMembers.findFirst({ where: and(eq(staffMembers.organizationId, orgId), eq(staffMembers.userId, uid)) });
  if (!staff && role !== 'system_admin') {
    const [created] = await db.insert(staffMembers).values({
      organizationId: orgId, userId: uid, firstName, lastName, status: 'active',
    }).returning();
    staff = created!;
  }
  return { uid, staffId: staff?.id };
}

async function main() {
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'music-and-life') });
  if (!org) throw new Error('Org not found');
  const orgId = org.id;

  const famA = await ensureFamily(orgId, 'QA Audit Family A', 'qa-audit-a@musiclife.test');
  const famB = await ensureFamily(orgId, 'QA Audit Family B', 'qa-audit-b@musiclife.test');

  const stuA1 = await ensureStudent(orgId, famA.id, 'AuditA1', 'Familya');
  const stuA2 = await ensureStudent(orgId, famA.id, 'AuditA2', 'Familya');
  const stuB1 = await ensureStudent(orgId, famB.id, 'AuditB1', 'Familyb');

  await ensureGuardian(orgId, famA.id, 'qa-audit-guardian-a@musiclife.test');
  await ensureGuardian(orgId, famB.id, 'qa-audit-guardian-b@musiclife.test');
  await ensureStudentLogin(orgId, stuA1.id, 'qa-audit-student-a1@musiclife.test');
  await ensureStudentLogin(orgId, stuB1.id, 'qa-audit-student-b1@musiclife.test');

  const teacherX = await ensureStaff(orgId, 'qa-audit-teacher-x@musiclife.test', 'teacher', 'AuditTeacher', 'X');
  const teacherY = await ensureStaff(orgId, 'qa-audit-teacher-y@musiclife.test', 'teacher', 'AuditTeacher', 'Y');
  await ensureStaff(orgId, 'qa-audit-admin@musiclife.test', 'admin', 'AuditAdmin', 'A');

  console.log(JSON.stringify({
    orgId,
    password: PASS,
    familyA: { id: famA.id, students: [stuA1.id, stuA2.id] },
    familyB: { id: famB.id, students: [stuB1.id] },
    teacherX: teacherX.staffId,
    teacherY: teacherY.staffId,
  }, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
