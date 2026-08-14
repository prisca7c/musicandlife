// Gives the new test student (Mana Meizhallo) an active enrollment with the
// new test teacher (Anthony Chien), so the family booking flow (which needs a
// real instrument/rate/teacher to show anything bookable) is actually
// exercisable during QA. Idempotent.
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { eq, and } from 'drizzle-orm';
import { createDb, organizations, staffMembers, students, enrollments } from '../src/index';

const db = createDb(process.env.DATABASE_URL!);

async function main() {
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'music-and-life') });
  if (!org) throw new Error('Org not found');
  const orgId = org.id;

  const teacher = await db.query.staffMembers.findFirst({
    where: and(eq(staffMembers.organizationId, orgId), eq(staffMembers.firstName, 'Anthony'), eq(staffMembers.lastName, 'Chien (TEST)')),
  });
  if (!teacher) throw new Error('Test teacher not found — run add-test-accounts.ts first');

  const student = await db.query.students.findFirst({
    where: and(eq(students.organizationId, orgId), eq(students.firstName, 'Mana'), eq(students.lastName, 'Meizhallo (TEST)')),
  });
  if (!student) throw new Error('Test student not found — run add-test-accounts.ts first');

  const existing = await db.query.enrollments.findFirst({
    where: and(eq(enrollments.organizationId, orgId), eq(enrollments.studentId, student.id), eq(enrollments.teacherId, teacher.id)),
  });
  if (existing) {
    console.log('✓ Enrollment already exists:', existing.id);
    process.exit(0);
  }

  const [created] = await db.insert(enrollments).values({
    organizationId: orgId, studentId: student.id, teacherId: teacher.id,
    instrument: 'piano', lessonType: 'private', rate: 4000, defaultDuration: 60,
    status: 'active', autoRenew: true,
  }).returning();

  console.log('✓ Created enrollment:', created!.id);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
