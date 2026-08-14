// Deactivates the teacher Anthony Chien (anthonychien@gmail.com) at the
// studio owner's request — same effect as the admin "Staff" page status
// toggle (StaffService.update setting status='inactive'), not a delete.
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { eq, and } from 'drizzle-orm';
import { createDb, organizations, users, staffMembers } from '../src/index';

const db = createDb(process.env.DATABASE_URL!);

async function main() {
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'music-and-life') });
  const orgId = org!.id;

  const user = await db.query.users.findFirst({ where: eq(users.email, 'anthonychien@gmail.com') });
  if (!user) throw new Error('User not found');

  const staff = await db.query.staffMembers.findFirst({
    where: and(eq(staffMembers.organizationId, orgId), eq(staffMembers.userId, user.id)),
  });
  if (!staff) throw new Error('Staff record not found');
  if (staff.status === 'inactive') { console.log('Already inactive.'); process.exit(0); }

  await db.update(staffMembers)
    .set({ status: 'inactive', updatedAt: new Date() })
    .where(eq(staffMembers.id, staff.id));

  console.log(`✓ Deactivated staff record: ${staff.firstName} ${staff.lastName} (${staff.id})`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
