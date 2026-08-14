import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { sql } from 'drizzle-orm';
import { createDb } from '../src/index';

const db = createDb(process.env.DATABASE_URL!);

async function main() {
  const orgs = await db.execute(sql`select id, name, slug, timezone, currency from organizations`);
  console.log('ORGS', orgs);
  const staff = await db.execute(sql`select id, first_name, last_name, status from staff_members order by last_name`);
  console.log('STAFF', staff);
  const terms = await db.execute(sql`select id, name, starts_on, ends_on, status from terms order by starts_on`);
  console.log('TERMS', terms);
  const counts = await db.execute(sql`select
    (select count(*) from students) as students,
    (select count(*) from families) as families,
    (select count(*) from guardians) as guardians,
    (select count(*) from enrollments) as enrollments,
    (select count(*) from lessons) as lessons,
    (select count(*) from invoices) as invoices,
    (select count(*) from payments) as payments`);
  console.log('COUNTS', counts);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
