import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });
import { eq, and } from 'drizzle-orm';
import { createDb, organizations, staffMembers } from '../src/index';

async function main() {
  const db = createDb(process.env.DATABASE_URL!);
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'music-and-life') });
  const all = await db.query.staffMembers.findMany({
    where: and(eq(staffMembers.organizationId, org!.id), eq(staffMembers.status, 'active')),
    with: { user: true },
    orderBy: (s, { asc }) => [asc(s.firstName), asc(s.lastName)],
  });
  for (const s of all) {
    console.log(`  ${s.firstName} ${s.lastName}: staffMember.createdAt=${s.createdAt.toISOString()}, user.createdAt=${s.user?.createdAt?.toISOString()}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
