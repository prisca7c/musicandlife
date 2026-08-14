// manameizhallo@gmail.com turned out to already belong to a pre-existing
// teacher fixture ("QAteacherOne TESTdelete") — add-test-accounts.ts reused
// that user (as ensureUser is designed to) and linked a new "Mana Meizhallo
// (TEST)" student row to it, but the account's membership is still 'teacher',
// so it can't actually log in to the family/student portal as requested.
// Removes only what THIS session added: the enrollment, the student row, and
// the "Chien Test Family (TEST)" family shell (kept only to hold that
// student). Leaves the pre-existing teacher account and its password (now
// 'asdf') untouched, and leaves the meiyiutsang@gmail.com guardian account
// (which had no collision) in place.
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { eq, and } from 'drizzle-orm';
import { createDb, organizations, users, students, enrollments } from '../src/index';

const db = createDb(process.env.DATABASE_URL!);

async function main() {
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'music-and-life') });
  const orgId = org!.id;

  const collidedUser = await db.query.users.findFirst({ where: eq(users.email, 'manameizhallo@gmail.com') });
  if (!collidedUser) { console.log('No user found — nothing to undo'); process.exit(0); }

  const student = await db.query.students.findFirst({
    where: and(eq(students.organizationId, orgId), eq(students.studentUserId, collidedUser.id)),
  });
  if (student) {
    await db.delete(enrollments).where(and(eq(enrollments.organizationId, orgId), eq(enrollments.studentId, student.id)));
    await db.delete(students).where(eq(students.id, student.id));
    console.log('✓ Removed mistaken student row + enrollment:', student.firstName, student.lastName);
    // The family shell (and its guardian, meiyiutsang@gmail.com — which had no
    // collision and is fine as-is) is left in place, just without a student
    // yet, until a non-colliding email is picked for the student role.
  } else {
    console.log('No student row linked to that user — nothing to remove there');
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
