import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and, gte, lte } from 'drizzle-orm';
import { payrollRuns, payrollItems, expenses, rateChangeRequests, lessons, attendance, staffMembers } from '@music-life/db';
import { DbService } from '../db/db.service';
import type { CreatePayrollRunDto } from './dto/create-payroll-run.dto';
import type { CreateExpenseDto } from './dto/create-expense.dto';

@Injectable()
export class PayrollService {
  constructor(private readonly db: DbService) {}

  // ─── Payroll runs ─────────────────────────────────────────────────────────
  async getPayrollRuns(orgId: string, staffId?: string) {
    return this.db.db.query.payrollRuns.findMany({
      where: staffId
        ? and(eq(payrollRuns.organizationId, orgId), eq(payrollRuns.staffId, staffId))
        : eq(payrollRuns.organizationId, orgId),
      with: { staff: { columns: { id: true, firstName: true, lastName: true } } },
      orderBy: (r, { desc }) => [desc(r.periodStart)],
    });
  }

  async createPayrollRun(orgId: string, dto: CreatePayrollRunDto) {
    const staff = await this.db.db.query.staffMembers.findFirst({
      where: and(eq(staffMembers.id, dto.staffId), eq(staffMembers.organizationId, orgId)),
    });
    if (!staff) throw new NotFoundException('Staff member not found');

    const start = new Date(dto.periodStart);
    const end = new Date(dto.periodEnd);

    // Find completed lessons and late-cancellations in period
    const periodLessons = await this.db.db.query.lessons.findMany({
      where: and(
        eq(lessons.organizationId, orgId),
        eq(lessons.teacherId, dto.staffId),
        gte(lessons.startsAt, start),
        lte(lessons.startsAt, end),
      ),
      with: { attendance: { columns: { actualStartedAt: true, actualEndedAt: true } } },
    });

    let totalMinutes = 0;
    const items: { lessonId: string; type: 'lesson' | 'late_cancellation'; minutes: number; amount: number }[] = [];

    for (const lesson of periodLessons) {
      if (lesson.status === 'completed') {
        // Use actual elapsed time if recorded, otherwise scheduled duration
        let minutes = lesson.duration;
        if (lesson.attendance?.actualStartedAt && lesson.attendance?.actualEndedAt) {
          minutes = Math.round((lesson.attendance.actualEndedAt.getTime() - lesson.attendance.actualStartedAt.getTime()) / 60000);
        }
        const amount = Math.round((minutes / 60) * staff.hourlyRate);
        items.push({ lessonId: lesson.id, type: 'lesson', minutes, amount });
        totalMinutes += minutes;
      } else if (lesson.status === 'cancelled_no_makeup') {
        // Student gave <24h notice — teacher still paid at scheduled duration
        const amount = Math.round((lesson.duration / 60) * staff.hourlyRate);
        items.push({ lessonId: lesson.id, type: 'late_cancellation', minutes: lesson.duration, amount });
        totalMinutes += lesson.duration;
      }
      // cancelled_makeup, cancelled_no_pay, cancelled_teacher → teacher not paid
    }

    const gross = items.reduce((s, i) => s + i.amount, 0);

    const [run] = await this.db.db.insert(payrollRuns).values({
      organizationId: orgId,
      staffId: dto.staffId,
      periodStart: dto.periodStart,
      periodEnd: dto.periodEnd,
      hoursElapsed: Math.round(totalMinutes / 60 * 100) / 100,
      hourlyRate: staff.hourlyRate,
      gross,
      status: 'draft',
    }).returning();

    for (const item of items) {
      await this.db.db.insert(payrollItems).values({
        organizationId: orgId,
        payrollRunId: run!.id,
        lessonId: item.lessonId,
        type: item.type,
        minutesElapsed: item.minutes,
        amount: item.amount,
      });
    }

    return { ...run!, items };
  }

  async approvePayrollRun(orgId: string, id: string, approvedBy: string) {
    const run = await this.db.db.query.payrollRuns.findFirst({
      where: and(eq(payrollRuns.id, id), eq(payrollRuns.organizationId, orgId)),
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== 'draft') throw new BadRequestException('Only draft runs can be approved');

    const [updated] = await this.db.db.update(payrollRuns)
      .set({ status: 'approved', approvedBy, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(payrollRuns.id, id))
      .returning();
    return updated!;
  }

  async getPayrollRun(orgId: string, id: string) {
    const run = await this.db.db.query.payrollRuns.findFirst({
      where: and(eq(payrollRuns.id, id), eq(payrollRuns.organizationId, orgId)),
      with: {
        staff: { columns: { id: true, firstName: true, lastName: true } },
        items: { with: { lesson: { columns: { id: true, startsAt: true, duration: true } } } },
      },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    return run;
  }

  // ─── Expenses ─────────────────────────────────────────────────────────────
  async getExpenses(orgId: string, staffId?: string) {
    return this.db.db.query.expenses.findMany({
      where: staffId
        ? and(eq(expenses.organizationId, orgId), eq(expenses.staffId, staffId))
        : eq(expenses.organizationId, orgId),
      with: { staff: { columns: { id: true, firstName: true, lastName: true } } },
      orderBy: (e, { desc }) => [desc(e.date)],
    });
  }

  async createExpense(orgId: string, dto: CreateExpenseDto) {
    const [expense] = await this.db.db.insert(expenses).values({ ...dto, organizationId: orgId }).returning();
    return expense!;
  }

  async approveExpense(orgId: string, id: string) {
    const [updated] = await this.db.db.update(expenses)
      .set({ status: 'approved' })
      .where(and(eq(expenses.id, id), eq(expenses.organizationId, orgId)))
      .returning();
    if (!updated) throw new NotFoundException('Expense not found');
    return updated;
  }

  // ─── Rate change requests ─────────────────────────────────────────────────
  async createRateChangeRequest(orgId: string, staffId: string, requestedRate: number) {
    const staff = await this.db.db.query.staffMembers.findFirst({
      where: and(eq(staffMembers.id, staffId), eq(staffMembers.organizationId, orgId)),
    });
    if (!staff) throw new NotFoundException('Staff not found');

    const [req] = await this.db.db.insert(rateChangeRequests).values({
      organizationId: orgId,
      staffId,
      currentRate: staff.hourlyRate,
      requestedRate,
      status: 'pending',
    }).returning();
    return req!;
  }

  async getRateChangeRequests(orgId: string) {
    return this.db.db.query.rateChangeRequests.findMany({
      where: eq(rateChangeRequests.organizationId, orgId),
      with: { staff: { columns: { id: true, firstName: true, lastName: true, hourlyRate: true } } },
      orderBy: (r, { desc }) => [desc(r.createdAt)],
    });
  }

  async decideRateChange(orgId: string, id: string, decision: 'approved' | 'denied', decidedBy: string) {
    const req = await this.db.db.query.rateChangeRequests.findFirst({
      where: and(eq(rateChangeRequests.id, id), eq(rateChangeRequests.organizationId, orgId)),
    });
    if (!req) throw new NotFoundException('Request not found');

    await this.db.db.update(rateChangeRequests)
      .set({ status: decision, decidedBy, decidedAt: new Date() })
      .where(eq(rateChangeRequests.id, id));

    if (decision === 'approved') {
      await this.db.db.update(staffMembers)
        .set({ hourlyRate: req.requestedRate, updatedAt: new Date() })
        .where(eq(staffMembers.id, req.staffId));
    }

    return { id, status: decision };
  }
}
