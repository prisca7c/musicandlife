import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import { attendance, lessons, enrollments, families, ledgerEntries, lessonCredits, staffMembers } from '@music-life/db';
import type { Db } from '@music-life/db';
import { DbService } from '../db/db.service';

// The pooled db or an open transaction — the billing side-effects run on
// whichever is passed so they share the mark-attendance transaction.
type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];
import type { MarkAttendanceDto } from './dto/mark-attendance.dto';
import { effectiveLessonAmount } from '../billing/billing.service';
import type { Actor } from '../scheduling/scheduling.service';

// Maps attendance status → lesson table status
const LESSON_STATUS_MAP = {
  present: 'completed',
  absent_makeup: 'cancelled_makeup',
  absent_no_makeup: 'cancelled_no_makeup',
  absent_no_pay: 'cancelled_no_pay',
  cancelled_teacher: 'cancelled_teacher',
} as const;

// Teacher is paid only when the lesson happened OR the family cancelled with
// less than 24 hours' notice.
const TEACHER_PAID_STATUSES = new Set<string>(['present', 'absent_no_makeup']);

// Studio cancellation policy:
//
//   ≥24h notice  → the family pays nothing, may rebook, and the teacher is not
//                  paid. Nothing is consumed and nothing is charged.
//   <24h notice  → the family pays, there is no makeup, and the teacher IS paid.
//
// `absent_makeup` used to sit in this set AND issue a makeup credit: a prepaid
// family had one credit taken and one given back (net zero), but a pay-as-you-go
// family was CHARGED for a lesson they cancelled a week early and handed a
// credit in return. The stated policy is that cancelling in good time costs
// nothing, so a ≥24h cancellation now consumes nothing and charges nothing —
// which lands both models in the same place: one lesson owed, one lesson's fee.
const CONSUMES_CREDIT_STATUSES = new Set<string>(['present', 'absent_no_makeup']);

// Only these attendance states put money on the family's account.
const CHARGEABLE_STATUSES = new Set<string>(['present', 'absent_no_makeup']);

// Choose which available credit a lesson should consume.
//
// A prepaid credit is banked at the rate of the enrolment it was bought for (the
// exact pence come off the family balance at purchase — see planPrepaidCredits).
// So a lesson must spend a credit bought for its OWN enrolment before falling
// back to a generic credit that carries no enrolment (e.g. a make-up granted by
// hand). It must NEVER spend a credit bought for a DIFFERENT enrolment: using a
// £25 violin credit to cover a £30 piano lesson mis-bills the family by the rate
// difference, and the ledger no longer reconciles against what was banked.
// Oldest-first within each group so credits are consumed in the order earned.
// Exported (pure) for unit testing without a DB.
export function pickCreditForEnrollment<T extends { enrollmentId: string | null; createdAt: Date }>(
  available: T[],
  enrollmentId: string | null,
): T | null {
  const byAge = [...available].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return byAge.find(c => c.enrollmentId === enrollmentId)
    ?? byAge.find(c => c.enrollmentId === null)
    ?? null;
}

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(private readonly db: DbService) {}

  private async resolveStaffId(orgId: string, userId: string): Promise<string | null> {
    const staff = await this.db.db.query.staffMembers.findFirst({
      where: and(eq(staffMembers.userId, userId), eq(staffMembers.organizationId, orgId)),
      columns: { id: true },
    });
    return staff?.id ?? null;
  }

  // Bulk "mark present" for a set of lessons in one call — backs the attendance
  // page's "Confirm all as present". Only touches lessons that are still
  // scheduled and have NO attendance yet, so a re-run can never double-charge a
  // family. Reuses markAttendance per lesson for identical credit/charge logic.
  async markManyPresent(orgId: string, lessonIds: string[], markedBy: string | null, actor?: Actor) {
    let marked = 0;
    let skipped = 0;
    let failed = 0;
    for (const id of [...new Set(lessonIds)]) {
      const lesson = await this.db.db.query.lessons.findFirst({
        where: and(eq(lessons.id, id), eq(lessons.organizationId, orgId)),
        columns: { id: true, status: true },
        with: { attendance: { columns: { status: true } } },
      });
      if (!lesson || lesson.status !== 'scheduled' || lesson.attendance) { skipped++; continue; }
      try {
        await this.markAttendance(orgId, id, { status: 'present' } as MarkAttendanceDto, markedBy, actor);
        marked++;
      } catch { failed++; }
    }
    return { marked, skipped, failed };
  }

  // Safety net for the attendance → billing/payroll gate: a lesson only produces
  // teacher pay and family charges once it's marked, so any lesson that finished
  // but was never marked is silent lost revenue. This finds lessons that ended more
  // than `graceHours` ago, are still `scheduled`, and have no attendance row, then
  // marks them present (across all orgs). The grace window leaves teachers time to
  // instead record an absence/cancellation. Idempotent via markManyPresent's guard.
  async autoCompleteOverdue(graceHours: number) {
    // Excludes a lesson whose teacher has since gone inactive. Deactivating a
    // teacher deliberately leaves their already-scheduled lessons untouched
    // (see the comment in scheduling.service.ts's inactive-teacher guards) —
    // it only stops NEW ones being generated — so this worker used to still
    // pick those lessons up, auto-mark them present, and trigger real billing
    // + payroll accrual for a teacher no longer employed. Leaving the lesson
    // 'scheduled' forever until staff manually reassign/cancel it is the
    // correct outcome here, not silently charging for it.
    const rows = (await this.db.db.execute(sql`
      select l.id, l.organization_id as "orgId"
      from lessons l
      left join staff_members sm on sm.id = l.teacher_id
      where l.status = 'scheduled'
        and (l.starts_at + make_interval(mins => l.duration)) < now() - make_interval(hours => ${graceHours})
        and not exists (select 1 from attendance a where a.lesson_id = l.id)
        and (l.teacher_id is null or sm.status = 'active')
    `)) as unknown as { id: string; orgId: string }[];

    const byOrg = new Map<string, string[]>();
    for (const r of rows) {
      const list = byOrg.get(r.orgId) ?? [];
      list.push(r.id);
      byOrg.set(r.orgId, list);
    }

    let marked = 0, skipped = 0, failed = 0;
    for (const [orgId, ids] of byOrg) {
      const res = await this.markManyPresent(orgId, ids, null);
      marked += res.marked; skipped += res.skipped; failed += res.failed;
    }
    return { orgs: byOrg.size, candidates: rows.length, marked, skipped, failed };
  }

  async markAttendance(orgId: string, lessonId: string, dto: MarkAttendanceDto, markedBy: string | null, actor?: Actor) {
    const lesson = await this.db.db.query.lessons.findFirst({
      where: and(eq(lessons.id, lessonId), eq(lessons.organizationId, orgId)),
      with: { enrollment: { columns: { id: true, rate: true, lessonType: true, studentId: true } } },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');

    if (actor?.role === 'teacher') {
      const staffId = await this.resolveStaffId(orgId, actor.userId);
      if (!staffId || lesson.teacherId !== staffId) throw new ForbiddenException('Not your lesson');
    }

    // actualStartedAt/actualEndedAt feed payroll directly (computeRunItems pays
    // the elapsed minutes between them when both are set) and family billing
    // never touches them, so nothing else validates them. A teacher marking
    // their OWN lesson can set any pair of timestamps; with no plausibility
    // check a 30-minute lesson could be recorded as 5 hours and paid as such.
    // Bound it to something a real lesson could plausibly run: never negative,
    // and capped at double the scheduled duration plus an hour's buffer for a
    // genuinely long session.
    if (dto.actualStartedAt && dto.actualEndedAt) {
      const elapsedMinutes = (new Date(dto.actualEndedAt).getTime() - new Date(dto.actualStartedAt).getTime()) / 60000;
      if (elapsedMinutes <= 0) {
        throw new BadRequestException('Actual end time must be after the actual start time.');
      }
      const maxPlausibleMinutes = lesson.duration * 2 + 60;
      if (elapsedMinutes > maxPlausibleMinutes) {
        throw new BadRequestException(
          `Actual duration (${Math.round(elapsedMinutes)} min) is implausible for a ${lesson.duration}-min lesson. Double-check the times.`,
        );
      }
    }

    const existing = await this.db.db.query.attendance.findFirst({
      where: eq(attendance.lessonId, lessonId),
    });

    const attendanceData = {
      status: dto.status,
      markedBy,
      markedAt: new Date(),
      actualStartedAt: dto.actualStartedAt ? new Date(dto.actualStartedAt) : undefined,
      actualEndedAt: dto.actualEndedAt ? new Date(dto.actualEndedAt) : undefined,
    };

    // The whole thing runs in one transaction so the attendance row, the lesson
    // status, and the credit/charge side-effects commit together (or not at all).
    return this.db.db.transaction(async (tx) => {
      let record;
      if (existing) {
        const [updated] = await tx
          .update(attendance)
          .set({ ...attendanceData, actualStartedAt: dto.actualStartedAt ? new Date(dto.actualStartedAt) : existing.actualStartedAt, actualEndedAt: dto.actualEndedAt ? new Date(dto.actualEndedAt) : existing.actualEndedAt })
          .where(eq(attendance.lessonId, lessonId))
          .returning();
        record = updated!;
      } else {
        const [inserted] = await tx
          .insert(attendance)
          .values({ organizationId: orgId, lessonId, ...attendanceData })
          .returning();
        record = inserted!;
      }

      // Update lesson status to match attendance
      await tx.update(lessons)
        .set({
          status: LESSON_STATUS_MAP[dto.status],
          cancelledAt: dto.status !== 'present' ? new Date() : null,
          actualStartedAt: dto.actualStartedAt ? new Date(dto.actualStartedAt) : undefined,
          actualEndedAt: dto.actualEndedAt ? new Date(dto.actualEndedAt) : undefined,
          updatedAt: new Date(),
        })
        .where(eq(lessons.id, lessonId));

      // Billing effects fire only when the attendance status actually changes.
      // On a change we FULLY reverse whatever the previous status applied
      // (release a consumed credit, void an unused makeup credit, refund a
      // per-lesson charge) and then apply the new status — so a correction like
      // present -> cancelled_no_pay doesn't leave the family charged, and a
      // re-save of the same status is a billing no-op.
      const statusChanged = !existing || existing.status !== dto.status;
      if (statusChanged) {
        if (existing) await this.reverseLessonBilling(tx, orgId, lesson);
        await this.applyLessonBilling(tx, orgId, lesson, dto.status);
      }

      return record;
    });
  }

  // Apply the credit/charge effects for a newly-set attendance status.
  private async applyLessonBilling(
    tx: Executor,
    orgId: string,
    lesson: { id: string; enrollmentId: string | null; studentId: string; duration: number; isTrialLesson?: boolean | null; enrollment: { id: string; lessonType: string } | null },
    status: string,
  ) {
    // A cancellation with ≥24h notice (absent_makeup) and a no-charge absence
    // (absent_no_pay) both leave the account untouched: no credit consumed, no
    // charge posted. The lesson's status records which it was so the office
    // knows whether the family still wants the slot rebooked.
    if (!CONSUMES_CREDIT_STATUSES.has(status)) return;
    const enrollment = lesson.enrollment;

    // Group lessons: no credit pool, just a per-lesson charge.
    if (enrollment?.lessonType === 'group') {
      await this.postAutoCharge(tx, orgId, lesson);
      return;
    }

    // Private lessons: consume a prepaid credit if one is available…
    await this.consumeOneCredit(tx, orgId, lesson.studentId, lesson.id, lesson.enrollmentId);

    // …and, when no prepaid credit covered it, charge the family (PAYG).
    if (enrollment) await this.postAutoCharge(tx, orgId, lesson);
  }

  // Undo the credit/charge effects a previous attendance status applied to this
  // lesson. Driven purely by current state, so it's safe to run before
  // re-applying the new status' effects.
  private async reverseLessonBilling(tx: Executor, orgId: string, lesson: { id: string }) {
    // Release any prepaid credit that was consumed by this lesson.
    const consumed = await tx.query.lessonCredits.findMany({
      where: and(
        eq(lessonCredits.organizationId, orgId),
        eq(lessonCredits.usedInLessonId, lesson.id),
        eq(lessonCredits.status, 'used'),
      ),
      columns: { id: true },
    });
    for (const c of consumed) {
      await tx.update(lessonCredits)
        .set({ status: 'available', usedInLessonId: null })
        .where(eq(lessonCredits.id, c.id));
    }

    // Void a makeup credit this lesson issued — but only if it hasn't been spent.
    await tx.delete(lessonCredits).where(and(
      eq(lessonCredits.organizationId, orgId),
      eq(lessonCredits.type, 'makeup'),
      eq(lessonCredits.sourceLessonId, lesson.id),
      eq(lessonCredits.status, 'available'),
    ));

    // Refund any per-lesson auto-charge posted for this lesson: restore the
    // family balance and drop the (system-generated) charge rows so the next
    // status can post a fresh charge if it warrants one.
    const charges = await tx.query.ledgerEntries.findMany({
      where: and(
        eq(ledgerEntries.organizationId, orgId),
        eq(ledgerEntries.type, 'charge'),
        eq(ledgerEntries.lessonId, lesson.id),
      ),
      columns: { id: true, amount: true, familyId: true },
    });
    if (charges.length === 0) return;
    const familyId = charges[0]!.familyId;
    const restore = -charges.reduce((s, e) => s + e.amount, 0); // charges are negative → restore is positive

    await tx.delete(ledgerEntries).where(and(
      eq(ledgerEntries.organizationId, orgId),
      eq(ledgerEntries.type, 'charge'),
      eq(ledgerEntries.lessonId, lesson.id),
    ));

    if (restore === 0) return;
    const [family] = await tx.select({ balanceCached: families.balanceCached }).from(families)
      .where(and(eq(families.id, familyId), eq(families.organizationId, orgId)))
      .for('update');
    if (!family) return;
    await tx.update(families)
      .set({ balanceCached: family.balanceCached + restore, updatedAt: new Date() })
      .where(eq(families.id, familyId));
  }

  private async consumeOneCredit(tx: Executor, orgId: string, studentId: string, lessonId: string, enrollmentId: string | null) {
    const available = await tx.query.lessonCredits.findMany({
      where: and(
        eq(lessonCredits.organizationId, orgId),
        eq(lessonCredits.studentId, studentId),
        eq(lessonCredits.status, 'available'),
      ),
      columns: { id: true, enrollmentId: true, createdAt: true },
    });
    // Spend a credit bought for THIS enrolment (or a generic one), never one
    // bought for a different enrolment at a different rate — see the helper.
    const credit = pickCreditForEnrollment(available, enrollmentId);
    if (!credit) return; // PAYG — no eligible credit, auto-charge handles billing

    await tx.update(lessonCredits)
      .set({ status: 'used', usedInLessonId: lessonId })
      .where(eq(lessonCredits.id, credit.id));
  }

  private async postAutoCharge(tx: Executor, orgId: string, lesson: { id: string; enrollmentId: string | null; studentId: string; duration: number; isTrialLesson?: boolean | null }) {
    if (!lesson.enrollmentId) return;

    const enrollment = await tx.query.enrollments.findFirst({
      where: eq(enrollments.id, lesson.enrollmentId),
      with: { student: { with: { family: { columns: { id: true } } } } },
    });
    if (!enrollment) return;

    // Only charge PAYG families (no prepaid credits) — if a credit was consumed, skip charging
    const hasCredit = await tx.query.lessonCredits.findFirst({
      where: and(
        eq(lessonCredits.organizationId, orgId),
        eq(lessonCredits.studentId, enrollment.studentId),
        eq(lessonCredits.usedInLessonId, lesson.id),
      ),
      columns: { id: true },
    });
    if (hasCredit) return; // credit covered this lesson, no PAYG charge needed

    // Never post a second charge for the same lesson (idempotent re-apply).
    const existingCharge = await tx.query.ledgerEntries.findFirst({
      where: and(
        eq(ledgerEntries.organizationId, orgId),
        eq(ledgerEntries.type, 'charge'),
        eq(ledgerEntries.lessonId, lesson.id),
      ),
      columns: { id: true },
    });
    if (existingCharge) return;

    const familyId = (enrollment.student as { family?: { id: string } })?.family?.id;
    if (!familyId) return;

    // Lock the family row so concurrent charges/payments can't clobber the balance.
    const [family] = await tx.select({ balanceCached: families.balanceCached }).from(families)
      .where(and(eq(families.id, familyId), eq(families.organizationId, orgId)))
      .for('update');
    if (!family) return;

    // Trial flat price → group flat rate → prorated private rate, all decided in
    // billing's effectiveLessonAmount so this charge matches the invoice exactly.
    const amount = -effectiveLessonAmount({
      isTrialLesson: lesson.isTrialLesson,
      lessonType: enrollment.lessonType,
      rate: enrollment.rate,
      trialRate: enrollment.trialRate,
      defaultDuration: enrollment.defaultDuration,
      duration: lesson.duration,
    });
    const newBalance = family.balanceCached + amount;

    await tx.insert(ledgerEntries).values({
      organizationId: orgId,
      familyId,
      type: 'charge',
      amount,
      balanceAfter: newBalance,
      lessonId: lesson.id,
      description: `Lesson charge`,
    });

    await tx.update(families)
      .set({ balanceCached: newBalance, updatedAt: new Date() })
      .where(eq(families.id, familyId));
  }

  async getAttendance(orgId: string, lessonId: string, actor?: Actor) {
    if (actor?.role === 'teacher') {
      const lesson = await this.db.db.query.lessons.findFirst({
        where: and(eq(lessons.id, lessonId), eq(lessons.organizationId, orgId)),
        columns: { teacherId: true },
      });
      const staffId = await this.resolveStaffId(orgId, actor.userId);
      if (!lesson || !staffId || lesson.teacherId !== staffId) throw new NotFoundException('Lesson not found');
    }
    return this.db.db.query.attendance.findFirst({
      where: and(eq(attendance.lessonId, lessonId), eq(attendance.organizationId, orgId)),
    }) ?? null;
  }

  // Returns total available lesson credits for a student (shown in UI as "X lessons")
  async getLessonCreditBalance(orgId: string, studentId: string) {
    const credits = await this.db.db.query.lessonCredits.findMany({
      where: and(
        eq(lessonCredits.organizationId, orgId),
        eq(lessonCredits.studentId, studentId),
        eq(lessonCredits.status, 'available'),
      ),
    });
    return {
      total: credits.length,
      prepaid: credits.filter(c => c.type === 'prepaid').length,
      makeup: credits.filter(c => c.type === 'makeup').length,
    };
  }

  // Admin/teacher manually adds lesson credits (e.g. when student pays upfront)
  async addLessonCredits(
    orgId: string,
    studentId: string,
    count: number,
    type: 'prepaid' | 'makeup',
    opts: { enrollmentId?: string; sourcePaymentId?: string } = {},
  ) {
    const rows = Array.from({ length: count }, () => ({
      organizationId: orgId,
      studentId,
      enrollmentId: opts.enrollmentId ?? null,
      type,
      sourcePaymentId: opts.sourcePaymentId ?? null,
      status: 'available' as const,
    }));
    return this.db.db.insert(lessonCredits).values(rows).returning();
  }
}
