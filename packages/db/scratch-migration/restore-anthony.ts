// anthonychien@gmail.com should stay a real teacher (correction from the
// studio owner) — cleanup-fake-teachers.ts deleted it along with the other
// fake/test fixtures by mistake. Recreates the staff record + membership.
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { eq, and } from 'drizzle-orm';
import { createDb, organizations, users, memberships, staffMembers, staffPrivileges } from '../src/index';
import { DEFAULT_TEACHER_PRIVILEGES } from '@music-life/types';

const db = createDb(process.env.DATABASE_URL!);

async function main() {
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'music-and-life') });
  const orgId = org!.id;

  const user = await db.query.users.findFirst({ where: eq(users.email, 'anthonychien@gmail.com') });
  if (!user) throw new Error('User not found — expected anthonychien@gmail.com to already exist');

  const existingMembership = await db.query.memberships.findFirst({
    where: and(eq(memberships.userId, user.id), eq(memberships.organizationId, orgId)),
  });
  if (!existingMembership) {
    await db.insert(memberships).values({ userId: user.id, organizationId: orgId, baseRole: 'teacher' });
    console.log('✓ Restored teacher membership');
  }

  let staff = await db.query.staffMembers.findFirst({
    where: and(eq(staffMembers.organizationId, orgId), eq(staffMembers.userId, user.id)),
  });
  if (!staff) {
    const [created] = await db.insert(staffMembers).values({
      organizationId: orgId, userId: user.id,
      firstName: 'Anthony', lastName: 'Chien', status: 'active',
    }).returning();
    staff = created!;
    await db.insert(staffPrivileges).values({ organizationId: orgId, staffId: staff.id, privileges: DEFAULT_TEACHER_PRIVILEGES });
    console.log('✓ Restored staff record: Anthony Chien');
  } else {
    console.log('Staff record already exists');
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
