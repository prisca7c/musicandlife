// cleanup-fake-teachers.ts deleted the teacher membership for
// manameizhallo@gmail.com as part of removing its old staff row, then tried to
// UPDATE that (now-gone) row to baseRole 'student' — a no-op. Insert the
// missing student membership directly. Idempotent.
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { eq, and } from 'drizzle-orm';
import { createDb, organizations, users, memberships } from '../src/index';

const db = createDb(process.env.DATABASE_URL!);

async function main() {
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'music-and-life') });
  const orgId = org!.id;
  const user = await db.query.users.findFirst({ where: eq(users.email, 'manameizhallo@gmail.com') });
  if (!user) throw new Error('User not found');

  const existing = await db.query.memberships.findFirst({
    where: and(eq(memberships.userId, user.id), eq(memberships.organizationId, orgId)),
  });
  if (existing) {
    console.log('Membership already exists:', existing.baseRole);
  } else {
    await db.insert(memberships).values({ userId: user.id, organizationId: orgId, baseRole: 'student' });
    console.log('✓ Created student membership for manameizhallo@gmail.com');
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
