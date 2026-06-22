/**
 * Creates demo portal accounts for testing each role perspective.
 * Run with: pnpm --filter @music-life/db seed:test
 *
 * Accounts created:
 *   teacher@musiclife.test  /  Teacher123!   (teacher — Sarah Mitchell)
 *   parent@musiclife.test   /  Parent123!    (guardian — Johnson Family)
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { eq, and } from 'drizzle-orm';
import { hash } from 'argon2';
import {
  createDb,
  organizations, users, memberships,
  staffMembers, families, guardians,
} from './index';

const db = createDb(process.env.DATABASE_URL!);

const TEACHER_EMAIL = 'teacher@musiclife.test';
const TEACHER_PASS  = 'Teacher123!';
const PARENT_EMAIL  = 'parent@musiclife.test';
const PARENT_PASS   = 'Parent123!';

async function upsertUser(email: string, password: string) {
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) {
    const ph = await hash(password);
    await db.update(users).set({ passwordHash: ph, emailVerifiedAt: new Date() }).where(eq(users.id, existing.id));
    console.log(`  updated user ${email}`);
    return existing.id;
  }
  const ph = await hash(password);
  const [u] = await db.insert(users).values({
    email,
    passwordHash: ph,
    emailVerifiedAt: new Date(),
  }).returning();
  console.log(`  created user ${email}`);
  return u!.id;
}

async function main() {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.slug, 'music-and-life'),
  });
  if (!org) { console.error('Org not found — run pnpm --filter @music-life/db seed first'); process.exit(1); }
  const orgId = org.id;

  // ── Teacher account ──────────────────────────────────────────────────────────
  console.log('\nSetting up teacher account…');
  const teacherUserId = await upsertUser(TEACHER_EMAIL, TEACHER_PASS);

  // Membership
  const existingTM = await db.query.memberships.findFirst({
    where: and(eq(memberships.userId, teacherUserId), eq(memberships.organizationId, orgId)),
  });
  if (!existingTM) {
    await db.insert(memberships).values({ userId: teacherUserId, organizationId: orgId, baseRole: 'teacher' });
    console.log('  created teacher membership');
  } else if (existingTM.baseRole !== 'teacher') {
    await db.update(memberships).set({ baseRole: 'teacher' }).where(eq(memberships.id, existingTM.id));
    console.log('  updated membership to teacher');
  }

  // Link to Sarah Mitchell staff record
  const sarah = await db.query.staffMembers.findFirst({
    where: and(
      eq(staffMembers.organizationId, orgId),
      eq(staffMembers.firstName, 'Sarah'),
      eq(staffMembers.lastName, 'Mitchell'),
    ),
  });
  if (sarah) {
    await db.update(staffMembers).set({ userId: teacherUserId }).where(eq(staffMembers.id, sarah.id));
    console.log('  linked teacher account to Sarah Mitchell');
  } else {
    console.log('  note: Sarah Mitchell staff record not found — teacher account created without staff link');
  }

  // ── Guardian account ─────────────────────────────────────────────────────────
  console.log('\nSetting up guardian account…');
  const parentUserId = await upsertUser(PARENT_EMAIL, PARENT_PASS);

  const existingPM = await db.query.memberships.findFirst({
    where: and(eq(memberships.userId, parentUserId), eq(memberships.organizationId, orgId)),
  });
  if (!existingPM) {
    await db.insert(memberships).values({ userId: parentUserId, organizationId: orgId, baseRole: 'guardian' });
    console.log('  created guardian membership');
  }

  // Link to Johnson Family
  const johnson = await db.query.families.findFirst({
    where: and(eq(families.organizationId, orgId), eq(families.name, 'Johnson Family')),
  });
  if (johnson) {
    const existingG = await db.query.guardians.findFirst({
      where: and(eq(guardians.familyId, johnson.id), eq(guardians.userId, parentUserId)),
    });
    if (!existingG) {
      await db.insert(guardians).values({
        organizationId: orgId,
        familyId: johnson.id,
        userId: parentUserId,
        relationship: 'parent',
      });
      console.log('  linked guardian to Johnson Family');
    } else {
      console.log('  guardian already linked to Johnson Family');
    }
  } else {
    console.log('  note: Johnson Family not found — guardian account created without family link');
  }

  console.log('\n✓ Done!\n');
  console.log('  Teacher:  teacher@musiclife.test  /  Teacher123!');
  console.log('  Guardian: parent@musiclife.test   /  Parent123!\n');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
