// Restores a standalone QA student login for portal testing (wiped along with
// all other students/families by the MMS CSV migration).
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { eq, and } from 'drizzle-orm';
import { hash } from 'argon2';
import { createDb, organizations, users, memberships, families, students } from '../src/index';

const db = createDb(process.env.DATABASE_URL!);
const EMAIL = 'qa.student@lirico.test';
const PASSWORD = 'asdf';

async function main() {
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'music-and-life') });
  if (!org) throw new Error('Org not found');
  const orgId = org.id;

  const passwordHash = await hash(PASSWORD);
  let user = await db.query.users.findFirst({ where: eq(users.email, EMAIL) });
  if (!user) {
    const [created] = await db.insert(users).values({ email: EMAIL, passwordHash, emailVerifiedAt: new Date() }).returning();
    user = created!;
  } else {
    await db.update(users).set({ passwordHash, emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
  }

  const existingMembership = await db.query.memberships.findFirst({
    where: and(eq(memberships.userId, user.id), eq(memberships.organizationId, orgId)),
  });
  if (!existingMembership) {
    await db.insert(memberships).values({ userId: user.id, organizationId: orgId, baseRole: 'student' });
  }

  let family = await db.query.families.findFirst({
    where: and(eq(families.organizationId, orgId), eq(families.name, 'QA Family (TEST)')),
  });
  if (!family) {
    const [created] = await db.insert(families).values({
      organizationId: orgId, name: 'QA Family (TEST)', contactName: 'QA Student (TEST)',
    }).returning();
    family = created!;
  }

  let student = await db.query.students.findFirst({
    where: and(eq(students.organizationId, orgId), eq(students.familyId, family.id), eq(students.firstName, 'QA')),
  });
  if (!student) {
    await db.insert(students).values({
      organizationId: orgId, familyId: family.id, firstName: 'QA', lastName: 'Student (TEST)',
      status: 'active', studentUserId: user.id,
    });
  } else {
    await db.update(students).set({ studentUserId: user.id, status: 'active' }).where(eq(students.id, student.id));
  }

  console.log(`✓ QA student login ready: ${EMAIL} / ${PASSWORD}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
