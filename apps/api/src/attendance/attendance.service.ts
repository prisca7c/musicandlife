import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { attendance, lessons, enrollments, families, ledgerEntries, lessonCredits, staffMembers } from '@music-life/db';
import { DbService } from '../db/db.service';
import type { MarkAttendanceDto } from './dto/mark-attendance.dto';
import { proratedAmount } from '../billing/billing.service';
import type { Actor } from '../scheduling/scheduling.service';

// Maps attendance status → lesson table status
const LESSON_STATUS_MAP = {
  present: 'completed',
  absent_makeup: 'cancelled_makeup',
  absent_no_makeup: 'cancelled_no_makeup',
  absent_no_pay: 'cancelled_no_pay',
  cancelled_teacher: 'cancelled_teacher',
} as const;

// Teacher is paid only when lesson happened OR student cancelled with <24h notice
const TEACHER_PAID_STATUSES = new Set<string>(['present', 'absent_no_makeup']);

// Student credit is consumed when lesson happened, late-cancelled, OR absent with makeup
// (absent_makeup: consume 1 existing credit + issue 1 makeup credit = net 0 for prepaid)
const CONSUMES_CREDIT_STATUSES = new Set<string>(['present', 'absent_no_makeup', 'absent_makeup']);

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
  async markManyPresent(orgId: string, lessonIds: string[], markedBy: string, actor?: Actor) {
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

  async markAttendance(orgId: string, lessonId: string, dto: MarkAttendanceDto, markedBy: string, actor?: Actor) {
    const lesson = await this.db.db.query.lessons.findFirst({
      where: and(eq(lessons.id, lessonId), eq(lessons.organizationId, orgId)),
      with: { enrollment: { columns: { id: true, rate: true, lessonType: true, studentId: true } } },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');

    if (actor?.role === 'teacher') {
      const staffId = await this.resolveStaffId(orgId, actor.userId);
      if (!staffId || lesson.teacherId !== staffId) throw new ForbiddenException('Not your lesson');
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

    let record;
    if (existing) {
      const [updated] = await this.db.db
        .update(attendance)
        .set({ ...attendanceData, actualStartedAt: dto.actualStartedAt ? new Date(dto.actualStartedAt) : existing.actualStartedAt, actualEndedAt: dto.actualEndedAt ? new Date(dto.actualEndedAt) : existing.actualEndedAt })
        .where(eq(attendance.lessonId, lessonId))
        .returning();
      record = updated!;
    } else {
      const [inserted] = await this.db.db
        .insert(attendance)
        .values({ organizationId: orgId, lessonId, ...attendanceData })
        .returning();
      record = inserted!;
    }

    // Update lesson status to match attendance
    await this.db.db.update(lessons)
      .set({
        status: LESSON_STATUS_MAP[dto.status],
        cancelledAt: dto.status !== 'present' ? new Date() : null,
        actualStartedAt: dto.actualStartedAt ? new Date(dto.actualStartedAt) : undefined,
        actualEndedAt: dto.actualEndedAt ? new Date(dto.actualEndedAt) : undefined,
        updatedAt: new Date(),
      })
      .where(eq(lessons.id, lessonId));

    const enrollment = lesson.enrollment;

    // Group lessons: no credits, just charge if present/late-cancel
    if (enrollment?.lessonType === 'group') {
      if (CONSUMES_CREDIT_STATUSES.has(dto.status)) {
        this.postAutoCharge(orgId, lesson).catch(err =>
          this.logger.warn(`Auto-charge failed for lesson ${lessonId}: ${err}`),
        );
      }
      return record;
    }

    // Private lessons: credit pool logic
    if (CONSUMES_CREDIT_STATUSES.has(dto.status)) {
      // Consume 1 available lesson credit (oldest first)
      await this.consumeOneCredit(orgId, lesson.studentId, lessonId);
    }

    if (dto.status === 'absent_makeup') {
      // Issue a makeup credit so the student can rebook at no extra cost
      await this.db.db.insert(lessonCredits).values({
        organizationId: orgId,
        studentId: lesson.studentId,
        enrollmentId: enrollment?.id ?? null,
        type: 'makeup',
        sourceLessonId: lessonId,
        status: 'available',
      });
    }

    // For present/absent_no_makeup: if no prepaid credit existed (PAYG), charge the family
    if (CONSUMES_CREDIT_STATUSES.has(dto.status) && enrollment) {
      this.postAutoCharge(orgId, lesson).catch(err =>
        this.logger.warn(`Auto-charge (PAYG) failed for lesson ${lessonId}: ${err}`),
      );
    }

    return record;
  }

  private async consumeOneCredit(orgId: string, studentId: string, lessonId: string) {
    const credit = await this.db.db.query.lessonCredits.findFirst({
      where: and(
        eq(lessonCredits.organizationId, orgId),
        eq(lessonCredits.studentId, studentId),
        eq(lessonCredits.status, 'available'),
      ),
      orderBy: (c, { asc }) => [asc(c.createdAt)],
    });
    if (!credit) return; // PAYG — no credit to consume, auto-charge handles billing

    await this.db.db.update(lessonCredits)
      .set({ status: 'used', usedInLessonId: lessonId })
      .where(eq(lessonCredits.id, credit.id));
  }

  private async postAutoCharge(orgId: string, lesson: { id: string; enrollmentId: string | null; studentId: string; duration: number }) {
    if (!lesson.enrollmentId) return;

    const enrollment = await this.db.db.query.enrollments.findFirst({
      where: eq(enrollments.id, lesson.enrollmentId),
      with: { student: { with: { family: { columns: { id: true, balanceCached: true } } } } },
    });
    if (!enrollment) return;

    // Only charge PAYG families (no prepaid credits) — if a credit was consumed, skip charging
    const hasCredit = await this.db.db.query.lessonCredits.findFirst({
      where: and(
        eq(lessonCredits.organizationId, orgId),
        eq(lessonCredits.studentId, enrollment.studentId),
        eq(lessonCredits.usedInLessonId, lesson.id),
      ),
    });
    if (hasCredit) return; // credit covered this lesson, no PAYG charge needed

    const family = (enrollment.student as { family?: { id: string; balanceCached: number } })?.family;
    if (!family) return;

    const amount = -proratedAmount(enrollment.rate, enrollment.defaultDuration, lesson.duration);
    const newBalance = family.balanceCached + amount;

    await this.db.db.insert(ledgerEntries).values({
      organizationId: orgId,
      familyId: family.id,
      type: 'charge',
      amount,
      balanceAfter: newBalance,
      description: `Lesson charge`,
    });

    await this.db.db.update(families)
      .set({ balanceCached: newBalance, updatedAt: new Date() })
      .where(eq(families.id, family.id));
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
