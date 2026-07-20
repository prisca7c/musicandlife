/**
 * Backfills lesson history, attendance, credits and an invoice for the
 * original 5 baseline families/8 students (from seed.ts) which predate
 * seed-bulk.ts and were left with enrollments but no lessons.
 * Run with: pnpm --filter @music-life/db seed:backfill
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { eq, isNull } from 'drizzle-orm';
import {
  createDb, organizations, terms, enrollments, lessons, attendance,
  lessonCredits, invoices, invoiceLineItems, payments,
} from './index';

const db = createDb(process.env.DATABASE_URL!);

function isoAt(base: Date, weekOffset: number, weekday: number, hour: number, minute: number) {
  const d = new Date(base);
  const day = d.getDay();
  d.setDate(d.getDate() - ((day === 0 ? 7 : day) - 1) + weekOffset * 7 + (weekday - 1));
  d.setHours(hour, minute, 0, 0);
  return d;
}
const WEEKDAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

async function main() {
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'music-and-life') });
  if (!org) { console.error('Org not found'); process.exit(1); }
  const orgId = org.id;
  const activeTerm = await db.query.terms.findFirst({ where: eq(terms.organizationId, orgId) });

  const orphanEnrollments = await db
    .select()
    .from(enrollments)
    .leftJoin(lessons, eq(lessons.enrollmentId, enrollments.id))
    .where(isNull(lessons.id));

  const seen = new Set<string>();
  const toBackfill = orphanEnrollments
    .map(r => r.enrollments)
    .filter(e => !seen.has(e.id) && seen.add(e.id));

  console.log(`Backfilling lessons for ${toBackfill.length} enrollments…`);
  const now = new Date();
  let lessonCount = 0, attendanceCount = 0;
  const lessonsByEnrollment = new Map<string, { id: string; startsAt: Date; status: string }[]>();

  for (const en of toBackfill) {
    const rule = en.scheduleRule as { weekday: string; startTime: string } | null;
    const weekdayIdx = rule ? WEEKDAY_NAMES.indexOf(rule.weekday) + 1 : 1;
    const [h, m] = (rule?.startTime ?? '16:00').split(':').map(Number) as [number, number];

    for (const weekOffset of [-3, -2, -1, 0, 1]) {
      const startsAt = isoAt(now, weekOffset, weekdayIdx || 1, h, m);
      const isPast = startsAt.getTime() < now.getTime();
      const status = isPast ? 'completed' : 'scheduled';

      const [lesson] = await db.insert(lessons).values({
        organizationId: orgId, enrollmentId: en.id, studentId: en.studentId,
        teacherId: en.teacherId ?? undefined, startsAt, duration: 60,
        status, termId: activeTerm?.id ?? undefined,
      }).returning();
      lessonCount++;
      const arr = lessonsByEnrollment.get(en.id) ?? [];
      arr.push({ id: lesson!.id, startsAt, status });
      lessonsByEnrollment.set(en.id, arr);

      if (status === 'completed') {
        await db.insert(attendance).values({ organizationId: orgId, lessonId: lesson!.id, status: 'present' });
        attendanceCount++;
      }
    }

    // A small prepaid credit balance for this student
    await db.insert(lessonCredits).values([
      { organizationId: orgId, studentId: en.studentId, type: 'prepaid', status: 'available' },
      { organizationId: orgId, studentId: en.studentId, type: 'prepaid', status: 'available' },
    ]);
  }

  // One paid invoice per affected family, itemized per completed lesson, sorted earliest first
  const studentsForEnrollments = await Promise.all(
    toBackfill.map(en => db.query.students.findFirst({ where: (s, { eq }) => eq(s.id, en.studentId) })),
  );
  const byFamily = new Map<string, { lessonId: string; description: string; amount: number; date: Date }[]>();
  toBackfill.forEach((en, i) => {
    const stu = studentsForEnrollments[i];
    if (!stu) return;
    const arr = byFamily.get(stu.familyId) ?? [];
    for (const lesson of lessonsByEnrollment.get(en.id) ?? []) {
      if (lesson.status !== 'completed') continue;
      arr.push({
        lessonId: lesson.id,
        description: '60 min lesson',
        amount: en.rate,
        date: lesson.startsAt,
      });
    }
    byFamily.set(stu.familyId, arr);
  });

  const today = now.toISOString().split('T')[0]!;
  const due = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0]!;
  let n = 9000;
  for (const [familyId, items] of byFamily) {
    if (items.length === 0) continue;
    items.sort((a, b) => a.date.getTime() - b.date.getTime());
    const total = items.reduce((s, i) => s + i.amount, 0);
    const [inv] = await db.insert(invoices).values({
      organizationId: orgId, familyId, mode: 'monthly_statement', termId: activeTerm?.id,
      number: `INV-${n++}`, issuedOn: today, dueDate: due, status: 'paid', total,
    }).returning();
    await db.insert(invoiceLineItems).values(
      items.map(i => ({ organizationId: orgId, invoiceId: inv!.id, lessonId: i.lessonId, description: i.description, amount: i.amount })),
    );
    await db.insert(payments).values({
      organizationId: orgId, familyId, invoiceId: inv!.id, method: 'bank_transfer', amount: total,
      idempotencyKey: `backfill-${inv!.id}`,
    });
  }

  console.log(`Done: ${lessonCount} lessons, ${attendanceCount} attendance records, ${byFamily.size} invoices.`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
