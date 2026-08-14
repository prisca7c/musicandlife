// Removes every staff record except the 5 real teachers (from the MMS import)
// and "QA Teacher (TEST)" (kept for testing). Also resolves the
// manameizhallo@gmail.com collision from earlier: that email belonged to one
// of the fake teachers being deleted here ("QAteacherOne TESTdelete") — once
// its staff row is gone, the account's membership is flipped from 'teacher' to
// 'student' and a real student record is created for it, linked to the
// existing "Chien Test Family (TEST)" (guardian: meiyiutsang@gmail.com),
// enrolled with QA Teacher (TEST) so the booking flow is testable end to end.
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { eq, and, inArray, isNull } from 'drizzle-orm';
import {
  createDb, organizations, users, memberships, staffMembers, staffPrivileges,
  teacherAssignments, availability, blockedTime, enrollments, lessons, resources,
  repertoirePieces, payrollRuns, rateChangeRequests, lessonRequests, expenses,
  families, students,
} from '../src/index';

const db = createDb(process.env.DATABASE_URL!);

const KEEP_NAMES = new Set([
  'Christine Kim', 'Dunni Oluwayemi', 'Franklin Tam', 'Orlando Bonzi', 'Yanice Bonzi',
  'QA Teacher (TEST)',
]);

async function deleteStaffMember(orgId: string, staff: { id: string; firstName: string; lastName: string; userId: string | null }) {
  const staffId = staff.id;

  // Explicit-delete tables with NOT NULL staffId (can't just null these out).
  await db.delete(payrollRuns).where(eq(payrollRuns.staffId, staffId));
  await db.delete(rateChangeRequests).where(eq(rateChangeRequests.staffId, staffId));
  await db.delete(lessonRequests).where(eq(lessonRequests.teacherId, staffId));

  // Nullable references — clear rather than delete the referencing row (a
  // lesson/enrollment/expense/resource isn't itself fake just because its
  // teacher assignment was).
  await db.update(enrollments).set({ teacherId: null }).where(eq(enrollments.teacherId, staffId));
  await db.update(lessons).set({ teacherId: null }).where(eq(lessons.teacherId, staffId));
  await db.update(resources).set({ teacherId: null }).where(eq(resources.teacherId, staffId));
  await db.update(repertoirePieces).set({ teacherId: null }).where(eq(repertoirePieces.teacherId, staffId));
  await db.update(expenses).set({ staffId: null }).where(eq(expenses.staffId, staffId));

  // staffPrivileges / teacherAssignments / availability / blockedTime all
  // cascade automatically on staffMembers delete.
  await db.delete(staffMembers).where(eq(staffMembers.id, staffId));

  // Drop their org membership too, so they stop showing up anywhere staff are
  // listed by membership (e.g. messaging recipients) — but leave the `users`
  // row itself alone; it may still be referenced elsewhere and deleting it is
  // out of scope for "remove fake teachers".
  if (staff.userId) {
    await db.delete(memberships).where(and(eq(memberships.userId, staff.userId), eq(memberships.organizationId, orgId)));
  }

  console.log(`✓ Deleted staff: ${staff.firstName} ${staff.lastName}`);
}

async function main() {
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'music-and-life') });
  if (!org) throw new Error('Org not found');
  const orgId = org.id;

  const all = await db.query.staffMembers.findMany({ where: eq(staffMembers.organizationId, orgId) });
  const toDelete = all.filter(s => !KEEP_NAMES.has(`${s.firstName} ${s.lastName}`));
  const kept = all.filter(s => KEEP_NAMES.has(`${s.firstName} ${s.lastName}`));

  console.log(`Keeping ${kept.length}: ${kept.map(s => `${s.firstName} ${s.lastName}`).join(', ')}`);
  console.log(`Deleting ${toDelete.length}: ${toDelete.map(s => `${s.firstName} ${s.lastName}`).join(', ')}`);

  for (const staff of toDelete) {
    await deleteStaffMember(orgId, staff);
  }

  // ── Resolve the manameizhallo@gmail.com collision ─────────────────────────
  const collidedUser = await db.query.users.findFirst({ where: eq(users.email, 'manameizhallo@gmail.com') });
  if (collidedUser) {
    await db.update(memberships)
      .set({ baseRole: 'student' })
      .where(and(eq(memberships.userId, collidedUser.id), eq(memberships.organizationId, orgId)));

    const family = await db.query.families.findFirst({
      where: and(eq(families.organizationId, orgId), eq(families.name, 'Chien Test Family (TEST)')),
    });
    if (family) {
      let student = await db.query.students.findFirst({
        where: and(eq(students.organizationId, orgId), eq(students.studentUserId, collidedUser.id)),
      });
      if (!student) {
        const [created] = await db.insert(students).values({
          organizationId: orgId, familyId: family.id,
          firstName: 'Mana', lastName: 'Meizhallo (TEST)',
          status: 'active', studentUserId: collidedUser.id,
        }).returning();
        student = created!;
        console.log('✓ Created student record for manameizhallo@gmail.com');
      }

      const qaTeacher = await db.query.staffMembers.findFirst({
        where: and(eq(staffMembers.organizationId, orgId), eq(staffMembers.firstName, 'QA'), eq(staffMembers.lastName, 'Teacher (TEST)')),
      });
      if (qaTeacher) {
        const existingEnrollment = await db.query.enrollments.findFirst({
          where: and(eq(enrollments.organizationId, orgId), eq(enrollments.studentId, student.id), eq(enrollments.teacherId, qaTeacher.id)),
        });
        if (!existingEnrollment) {
          await db.insert(enrollments).values({
            organizationId: orgId, studentId: student.id, teacherId: qaTeacher.id,
            instrument: 'piano', lessonType: 'private', rate: 4000, defaultDuration: 60,
            status: 'active', autoRenew: true,
          });
          console.log('✓ Enrolled test student with QA Teacher (TEST)');
        }

        const existingAvail = await db.query.availability.findMany({
          where: and(eq(availability.organizationId, orgId), eq(availability.staffId, qaTeacher.id)),
        });
        if (existingAvail.length === 0) {
          await db.insert(availability).values(
            (['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const).map((weekday) => ({
              organizationId: orgId, staffId: qaTeacher.id, weekday, startTime: '09:00', endTime: '18:00',
            })),
          );
          console.log('✓ Added weekday availability for QA Teacher (TEST)');
        }
      } else {
        console.warn('⚠ "QA Teacher (TEST)" not found — student created without an enrollment');
      }
    } else {
      console.warn('⚠ "Chien Test Family (TEST)" not found — could not create student record');
    }
    console.log('✓ manameizhallo@gmail.com is now a student login');
  } else {
    console.log('manameizhallo@gmail.com has no user row — nothing to convert');
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
