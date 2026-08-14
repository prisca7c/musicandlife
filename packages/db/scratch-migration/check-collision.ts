import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });
import { eq, and } from 'drizzle-orm';
import { createDb, organizations, users, memberships, students, staffMembers } from '../src/index';

async function main() {
  const db = createDb(process.env.DATABASE_URL!);
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'music-and-life') });
  const orgId = org!.id;
  for (const email of ['manameizhallo@gmail.com', 'meiyiutsang@gmail.com', 'anthonychien@gmail.com']) {
    const u = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (!u) { console.log(email, '-> no user'); continue; }
    const m = await db.query.memberships.findMany({ where: and(eq(memberships.userId, u.id), eq(memberships.organizationId, orgId)) });
    const staff = await db.query.staffMembers.findFirst({ where: eq(staffMembers.userId, u.id) });
    const stud = await db.query.students.findFirst({ where: eq(students.studentUserId, u.id) });
    console.log(email, '-> userId', u.id, 'memberships:', JSON.stringify(m.map(x => x.baseRole)), 'staff:', staff?.firstName, staff?.lastName, 'student:', stud?.firstName, stud?.lastName);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
