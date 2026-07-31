import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { eq, and, gte, lte, inArray } from 'drizzle-orm';
import { payrollRuns, payrollItems, expenses, rateChangeRequests, lessons, attendance, staffMembers, files } from '@music-life/db';
import { DbService } from '../db/db.service';
import type { CreatePayrollRunDto } from './dto/create-payroll-run.dto';
import type { CreateExpenseDto } from './dto/create-expense.dto';
import type { CreateRateChangeDto } from './dto/create-rate-change.dto';
import { ROLE_LEVEL, type BaseRole } from '@music-life/types';

export interface Actor { role: BaseRole; userId: string }

// The payroll period end arrives as a bare calendar date (the UI's
// <input type="date">), so `new Date('2026-06-30')` is midnight UTC. Comparing
// lessons with `startsAt <= end` against that would exclude every lesson on the
// final day (any time after 00:00Z is "greater"), silently underpaying the
// teacher for that day. Extend the bound to the end of that calendar day (UTC),
// consistent with the rest of this module treating period dates as UTC.
// Exported so the boundary can be unit-tested directly.
export function periodEndInclusive(end: Date): Date {
  const inclusive = new Date(end);
  inclusive.setUTCHours(23, 59, 59, 999);
  return inclusive;
}

@Injectable()
export class PayrollService {
  constructor(private readonly db: DbService) {}

  // Which staff record a payroll write applies to. Managers+ may file on behalf
  // of any staff member (an explicit staffId is honoured); a teacher is always
  // pinned to their own record so they can't attribute expenses / rate-change
  // requests to a colleague by passing someone else's id.
  private async resolveTargetStaffId(orgId: string, actor: Actor, requestedStaffId?: string): Promise<string> {
    const isManagement = ROLE_LEVEL[actor.role] >= ROLE_LEVEL['manager'];
    if (isManagement && requestedStaffId) {
      const staff = await this.db.db.query.staffMembers.findFirst({
        where: and(eq(staffMembers.id, requestedStaffId), eq(staffMembers.organizationId, orgId)),
        columns: { id: true },
      });
      if (!staff) throw new NotFoundException('Staff not found');
      return staff.id;
    }
    const own = await this.db.db.query.staffMembers.findFirst({
      where: and(eq(staffMembers.userId, actor.userId), eq(staffMembers.organizationId, orgId)),
      columns: { id: true },
    });
    if (!own) throw new NotFoundException('No staff record for this user');
    return own.id;
  }

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

  /**
   * A teacher's own pay history.
   *
   * Payroll was manager-only end to end, so a teacher had no way to see what
   * they had been paid — despite `payroll.view_own` existing in the privilege
   * set and defaulting to true for teachers. Nothing honoured it.
   *
   * Deliberately excludes DRAFT runs. A draft is a working figure the office is
   * still checking; showing it to the teacher turns every later correction into
   * an argument about a number they were shown. Approved and paid runs only,
   * with each run's lesson-by-lesson breakdown so the figure can be checked.
   */
  async getMyPayrollRuns(orgId: string, userId: string) {
    const own = await this.db.db.query.staffMembers.findFirst({
      where: and(eq(staffMembers.userId, userId), eq(staffMembers.organizationId, orgId)),
      columns: { id: true },
    });
    if (!own) throw new NotFoundException('No staff record for this user');

    const runs = await this.db.db.query.payrollRuns.findMany({
      where: and(
        eq(payrollRuns.organizationId, orgId),
        eq(payrollRuns.staffId, own.id),
        inArray(payrollRuns.status, ['approved', 'paid']),
      ),
      with: {
        items: { with: { lesson: { columns: { id: true, startsAt: true, duration: true } } } },
      },
      orderBy: (r, { desc }) => [desc(r.periodStart)],
    });

    return runs.map(r => ({
      id: r.id,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      hoursElapsed: r.hoursElapsed,
      hourlyRate: r.hourlyRate,
      gross: r.gross,
      status: r.status,
      approvedAt: r.approvedAt,
      items: r.items.map(i => ({
        id: i.id,
        type: i.type,
        minutesElapsed: i.minutesElapsed,
        amount: i.amount,
        startsAt: i.lesson?.startsAt ?? null,
      })),
    }));
  }

  // Compute payable items for one teacher over a period from their completed
  // lessons and late-cancellations. Pure calculation — no writes.
  private async computeRunItems(orgId: string, staffId: string, hourlyRate: number, start: Date, end: Date) {
    const periodLessons = await this.db.db.query.lessons.findMany({
      where: and(
        eq(lessons.organizationId, orgId),
        eq(lessons.teacherId, staffId),
        gte(lessons.startsAt, start),
        lte(lessons.startsAt, periodEndInclusive(end)),
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
        const amount = Math.round((minutes / 60) * hourlyRate);
        items.push({ lessonId: lesson.id, type: 'lesson', minutes, amount });
        totalMinutes += minutes;
      } else if (lesson.status === 'cancelled_no_makeup') {
        // Student gave <24h notice — teacher still paid at scheduled duration
        const amount = Math.round((lesson.duration / 60) * hourlyRate);
        items.push({ lessonId: lesson.id, type: 'late_cancellation', minutes: lesson.duration, amount });
        totalMinutes += lesson.duration;
      }
      // cancelled_makeup, cancelled_no_pay, cancelled_teacher → teacher not paid
    }

    const gross = items.reduce((s, i) => s + i.amount, 0);
    return { items, totalMinutes, gross };
  }

  // Persist a draft run + its items for one teacher/period.
  private async persistRun(
    orgId: string, staffId: string, periodStart: string, periodEnd: string, hourlyRate: number,
    computed: { items: { lessonId: string; type: 'lesson' | 'late_cancellation'; minutes: number; amount: number }[]; totalMinutes: number; gross: number },
  ) {
    // `onConflictDoNothing()` (no target) is the atomic backstop for the racy
    // pre-check in the callers: once the `payroll_runs_period_uq` index exists, a
    // second concurrent insert for the same teacher+period conflicts and returns
    // no row. Deliberately target-less so this is also safe to deploy BEFORE the
    // migration lands — with no unique index there is simply no conflict, exactly
    // today's behaviour, rather than a "no matching ON CONFLICT" error. A null
    // return means "someone already has this period"; the caller decides whether
    // that's a conflict (single create) or a skip (batch).
    const [run] = await this.db.db.insert(payrollRuns).values({
      organizationId: orgId,
      staffId,
      periodStart,
      periodEnd,
      hoursElapsed: Math.round(computed.totalMinutes / 60 * 100) / 100,
      hourlyRate,
      gross: computed.gross,
      status: 'draft',
    }).onConflictDoNothing().returning();
    if (!run) return null;

    for (const item of computed.items) {
      await this.db.db.insert(payrollItems).values({
        organizationId: orgId,
        payrollRunId: run!.id,
        lessonId: item.lessonId,
        type: item.type,
        minutesElapsed: item.minutes,
        amount: item.amount,
      });
    }

    return { ...run, items: computed.items };
  }

  async createPayrollRun(orgId: string, dto: CreatePayrollRunDto) {
    const staff = await this.db.db.query.staffMembers.findFirst({
      where: and(eq(staffMembers.id, dto.staffId), eq(staffMembers.organizationId, orgId)),
    });
    if (!staff) throw new NotFoundException('Staff member not found');

    // Reject a duplicate run for the same teacher+period. The batch path
    // (createPayrollRunsForAll) already skips existing runs; without the same
    // guard here, two single-creates would produce two runs over the identical
    // lessons and pay the teacher twice if both were approved.
    const existing = await this.db.db.query.payrollRuns.findFirst({
      where: and(
        eq(payrollRuns.organizationId, orgId),
        eq(payrollRuns.staffId, dto.staffId),
        eq(payrollRuns.periodStart, dto.periodStart),
        eq(payrollRuns.periodEnd, dto.periodEnd),
      ),
      columns: { id: true },
    });
    if (existing) throw new ConflictException('A payroll run already exists for this teacher and period');

    const computed = await this.computeRunItems(orgId, dto.staffId, staff.hourlyRate, new Date(dto.periodStart), new Date(dto.periodEnd));
    const run = await this.persistRun(orgId, dto.staffId, dto.periodStart, dto.periodEnd, staff.hourlyRate, computed);
    // Lost the race against a concurrent create that slipped past the pre-check.
    if (!run) throw new ConflictException('A payroll run already exists for this teacher and period');
    return run;
  }

  // Batch: draft a payroll run for every active teacher over one period, in a
  // single click. Skips teachers who already have a run for the exact period (so
  // it's safe to re-run) and teachers with no payable lessons (no empty runs).
  async createPayrollRunsForAll(orgId: string, periodStart: string, periodEnd: string) {
    const start = new Date(periodStart);
    const end = new Date(periodEnd);

    const staff = await this.db.db.query.staffMembers.findMany({
      where: and(eq(staffMembers.organizationId, orgId), eq(staffMembers.status, 'active')),
    });

    const created: { staffId: string; name: string; runId: string; gross: number; items: number }[] = [];
    let skippedExisting = 0;
    let skippedEmpty = 0;

    for (const s of staff) {
      const existing = await this.db.db.query.payrollRuns.findFirst({
        where: and(
          eq(payrollRuns.organizationId, orgId),
          eq(payrollRuns.staffId, s.id),
          eq(payrollRuns.periodStart, periodStart),
          eq(payrollRuns.periodEnd, periodEnd),
        ),
        columns: { id: true },
      });
      if (existing) { skippedExisting++; continue; }

      const computed = await this.computeRunItems(orgId, s.id, s.hourlyRate, start, end);
      if (computed.items.length === 0) { skippedEmpty++; continue; }

      const run = await this.persistRun(orgId, s.id, periodStart, periodEnd, s.hourlyRate, computed);
      // A run appeared between the pre-check and the insert (e.g. a concurrent
      // batch or single create). Treat it as already-existing, not a hard error.
      if (!run) { skippedExisting++; continue; }
      created.push({ staffId: s.id, name: `${s.firstName} ${s.lastName}`, runId: run.id, gross: computed.gross, items: computed.items.length });
    }

    return { staffConsidered: staff.length, created, skippedExisting, skippedEmpty };
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
      with: {
        staff: { columns: { id: true, firstName: true, lastName: true } },
        receiptFile: { columns: { id: true, originalName: true, mime: true } },
      },
      orderBy: (e, { desc }) => [desc(e.date)],
    });
  }

  async createExpense(orgId: string, dto: CreateExpenseDto, actor: Actor) {
    const staffId = await this.resolveTargetStaffId(orgId, actor, dto.staffId);
    // receiptFileId is a caller-supplied FK to files: a bogus id 500s on the
    // constraint and a foreign-org id would attach another studio's file.
    if (dto.receiptFileId) {
      const file = await this.db.db.query.files.findFirst({
        where: and(eq(files.id, dto.receiptFileId), eq(files.organizationId, orgId)),
        columns: { id: true },
      });
      if (!file) throw new NotFoundException('Receipt file not found');
    }
    const [expense] = await this.db.db.insert(expenses).values({ ...dto, staffId, organizationId: orgId }).returning();
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
  async createRateChangeRequest(orgId: string, dto: CreateRateChangeDto, actor: Actor) {
    const staffId = await this.resolveTargetStaffId(orgId, actor, dto.staffId);
    const staff = await this.db.db.query.staffMembers.findFirst({
      where: and(eq(staffMembers.id, staffId), eq(staffMembers.organizationId, orgId)),
    });
    if (!staff) throw new NotFoundException('Staff not found');

    const [req] = await this.db.db.insert(rateChangeRequests).values({
      organizationId: orgId,
      staffId,
      currentRate: staff.hourlyRate,
      requestedRate: dto.requestedRate,
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
    if (req.status !== 'pending') throw new BadRequestException('Request already decided');

    // Guarded claim: only transition if still pending. Without this an already
    // approved request could be approved again and re-write the staff rate to a
    // now-stale value (and two concurrent approvals would both apply it).
    const claimed = await this.db.db.update(rateChangeRequests)
      .set({ status: decision, decidedBy, decidedAt: new Date() })
      .where(and(
        eq(rateChangeRequests.id, id),
        eq(rateChangeRequests.organizationId, orgId),
        eq(rateChangeRequests.status, 'pending'),
      ))
      .returning({ id: rateChangeRequests.id });
    if (claimed.length === 0) throw new BadRequestException('Request already decided');

    if (decision === 'approved') {
      await this.db.db.update(staffMembers)
        .set({ hourlyRate: req.requestedRate, updatedAt: new Date() })
        .where(and(eq(staffMembers.id, req.staffId), eq(staffMembers.organizationId, orgId)));
    }

    return { id, status: decision };
  }
}
