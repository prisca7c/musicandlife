import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });
import { eq } from 'drizzle-orm';
import { createDb, organizations, staffMembers } from '../src/index';

async function main() {
  const db = createDb(process.env.DATABASE_URL!);
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'music-and-life') });
  const all = await db.query.staffMembers.findMany({ where: eq(staffMembers.organizationId, org!.id) });
  console.log(`${all.length} staff members:`);
  for (const s of all) console.log(`  ${s.firstName} ${s.lastName} (${s.status})`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
