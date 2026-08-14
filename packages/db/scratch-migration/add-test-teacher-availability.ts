// Gives the test teacher (Anthony Chien) weekly availability windows so the
// family booking flow has actual bookable slots to show. Idempotent.
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { eq, and } from 'drizzle-orm';
import { createDb, organizations, staffMembers, availability } from '../src/index';

const db = createDb(process.env.DATABASE_URL!);
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;

async function main() {
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'music-and-life') });
  if (!org) throw new Error('Org not found');
  const orgId = org.id;

  const teacher = await db.query.staffMembers.findFirst({
    where: and(eq(staffMembers.organizationId, orgId), eq(staffMembers.firstName, 'Anthony'), eq(staffMembers.lastName, 'Chien (TEST)')),
  });
  if (!teacher) throw new Error('Test teacher not found — run add-test-accounts.ts first');

  const existing = await db.query.availability.findMany({
    where: and(eq(availability.organizationId, orgId), eq(availability.staffId, teacher.id)),
  });
  if (existing.length > 0) {
    console.log(`✓ Availability already set (${existing.length} windows)`);
    process.exit(0);
  }

  await db.insert(availability).values(
    WEEKDAYS.map((weekday) => ({
      organizationId: orgId, staffId: teacher.id,
      weekday: weekday as typeof availability.$inferInsert['weekday'],
      startTime: '09:00', endTime: '18:00',
    })),
  );
  console.log(`✓ Added weekday 9am-6pm availability for Anthony Chien (TEST)`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
