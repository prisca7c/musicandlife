import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { eq, and, inArray, sum } from 'drizzle-orm';
import {
  invoices, invoiceLineItems, ledgerEntries, payments,
  families, students, enrollments, lessonCredits, lessons, organizations, attendance,
} from '@music-life/db';
import { DbService } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { CreateInvoiceDto } from './dto/create-invoice.dto';
import type { RecordPaymentDto } from './dto/record-payment.dto';

// A lesson billed at a different length than the student's normal duration is charged
// proportionally — e.g. a 30-min lesson on a 60-min/£rate enrollment charges half the rate.
export function proratedAmount(rate: number | undefined, defaultDuration: number | undefined, actualDuration: number): number {
  if (!rate) return 0;
  if (!defaultDuration || defaultDuration === actualDuration) return rate;
  return Math.round((rate * actualDuration) / defaultDuration);
}

/**
 * The fee for one lesson, honouring the three pricing rules in one place so the
 * invoice, the attendance charge, and the pay-now preview never diverge:
 *  - a TRIAL lesson with an explicit `trialRate` is a flat intro price (a trial
 *    is a fixed offer, not prorated, and it overrides the group rule too);
 *  - a GROUP class is a flat set price (everyone pays the same regardless of a
 *    few minutes over);
 *  - a private lesson is prorated against its default duration.
 */
export function effectiveLessonAmount(opts: {
  isTrialLesson?: boolean | null;
  lessonType?: string | null;
  rate?: number | null;
  trialRate?: number | null;
  defaultDuration?: number | null;
  duration: number;
}): number {
  if (opts.isTrialLesson && opts.trialRate != null) return opts.trialRate;
  if (opts.lessonType === 'group') return opts.rate ?? 0;
  return proratedAmount(opts.rate ?? undefined, opts.defaultDuration ?? undefined, opts.duration);
}

/**
 * Split a pot of on-account money into whole prepaid lessons across a family's
 * active private enrolments, proportionally by lesson rate.
 *
 * Pure so the money maths can be tested without a database. Returns which
 * enrolments get how many credits and the exact pence that buys them
 * (`allocated`) — the caller banks `allocated` off the family's cash balance so
 * the same money is never counted both as a balance and as free lessons.
 */
export function planPrepaidCredits(
  billable: Array<{ studentId: string; enrollmentId: string; rate: number }>,
  pot: number,
): { credits: Array<{ studentId: string; enrollmentId: string }>; allocated: number } {
  const credits: Array<{ studentId: string; enrollmentId: string }> = [];
  if (pot <= 0 || billable.length === 0) return { credits, allocated: 0 };

  const totalRate = billable.reduce((sum, b) => sum + b.rate, 0);
  if (totalRate <= 0) return { credits, allocated: 0 };

  let allocated = 0;
  for (const { studentId, enrollmentId, rate } of billable) {
    const share = (rate / totalRate) * pot;
    const creditCount = Math.floor(share / rate);
    for (let i = 0; i < creditCount; i++) credits.push({ studentId, enrollmentId });
    allocated += creditCount * rate;
  }
  return { credits, allocated };
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── Invoices ──────────────────────────────────────────────────────────────
  async getInvoices(orgId: string, familyId?: string) {
    return this.db.db.query.invoices.findMany({
      where: familyId
        ? and(eq(invoices.organizationId, orgId), eq(invoices.familyId, familyId))
        : eq(invoices.organizationId, orgId),
      with: { family: { columns: { id: true, name: true } } },
      // Newest invoice first, not oldest — issuedOn is a bare date, so a batch
      // of invoices generated the same day sorted by it alone had no reliable
      // order among themselves. createdAt is a real timestamp that always
      // agrees with invoice number order (numbers are assigned sequentially at
      // creation), without the pitfall of comparing "INV-0001" style numbers
      // as strings once the count passes 4 digits.
      orderBy: (i, { desc }) => [desc(i.createdAt)],
    });
  }

  async getInvoice(orgId: string, id: string) {
    const inv = await this.db.db.query.invoices.findFirst({
      where: and(eq(invoices.id, id), eq(invoices.organizationId, orgId)),
      with: {
        family: { columns: { id: true, name: true, email: true } },
        lineItems: {
          with: {
            lesson: {
              columns: { startsAt: true, duration: true },
              with: {
                teacher: { columns: { firstName: true, lastName: true } },
                student: { columns: { firstName: true, lastName: true } },
                enrollment: { columns: { instrument: true, lessonType: true } },
              },
            },
          },
        },
      },
    });
    if (!inv) throw new NotFoundException('Invoice not found');

    const lineItems = inv.lineItems
      .map(li => ({
        id: li.id,
        description: li.description,
        amount: li.amount,
        lessonId: li.lessonId,
        date: li.lesson?.startsAt ? li.lesson.startsAt.toISOString().split('T')[0]! : null,
        startsAt: li.lesson?.startsAt ? li.lesson.startsAt.toISOString() : null,
        duration: li.lesson?.duration ?? null,
        teacher: li.lesson?.teacher ? `${li.lesson.teacher.firstName} ${li.lesson.teacher.lastName}` : null,
        student: li.lesson?.student ? `${li.lesson.student.firstName} ${li.lesson.student.lastName}` : null,
        instrument: li.lesson?.enrollment?.instrument ?? null,
        lessonType: li.lesson?.enrollment?.lessonType ?? null,
      }))
      .sort((a, b) => {
        if (a.date && b.date) return a.date.localeCompare(b.date);
        if (a.date) return -1;
        if (b.date) return 1;
        return 0;
      });

    // Balance carried over from before this invoice was issued (prior charges/payments)
    const dayBefore = new Date(`${inv.issuedOn}T00:00:00`);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const { balance: balanceForward } = await this.getBalanceAsOf(
      orgId, inv.familyId, dayBefore.toISOString().split('T')[0]!,
    );

    return { ...inv, lineItems, balanceForward };
  }

  // Minimal, unauthenticated invoice summary for the "Click Here to Pay Online" link in the
  // PDF/email — the family may not have portal credentials at hand, so this intentionally
  // skips JwtAuthGuard. Invoice ids are unguessable UUIDs and only payment-reference fields
  // (no family PII beyond what's already on the printed invoice) are returned.
  async getPublicInvoiceSummary(id: string) {
    const inv = await this.db.db.query.invoices.findFirst({
      where: eq(invoices.id, id),
      columns: {
        id: true, number: true, total: true, status: true, dueDate: true, issuedOn: true,
        notes: true, organizationId: true, familyId: true,
      },
      with: {
        lineItems: {
          with: {
            lesson: {
              columns: { startsAt: true, duration: true },
              with: {
                teacher: { columns: { firstName: true, lastName: true } },
                student: { columns: { firstName: true, lastName: true } },
                enrollment: { columns: { instrument: true, lessonType: true } },
              },
            },
          },
        },
      },
    });
    // Only issued invoices are reachable via the public pay link. Drafts are
    // staff-only and not yet finalised; voids are cancelled — neither should be
    // resolvable (with the studio's bank details) by anyone holding the id.
    if (!inv || (inv.status !== 'sent' && inv.status !== 'paid')) {
      throw new NotFoundException('Invoice not found');
    }

    const [org, family] = await Promise.all([
      this.db.db.query.organizations.findFirst({ where: eq(organizations.id, inv.organizationId) }),
      this.db.db.query.families.findFirst({
        where: eq(families.id, inv.familyId),
        columns: { name: true, address: true },
      }),
    ]);
    const settings = (org?.settings as Record<string, unknown>) ?? {};

    // Same shape as the admin invoice detail's lineItems (getInvoice above) so
    // the public page can render the identical itemised breakdown and reuse
    // the same PDF template — a payer with nothing but the pay link had no
    // way to see what they were actually being charged for.
    const lineItems = inv.lineItems
      .map(li => ({
        id: li.id,
        description: li.description,
        amount: li.amount,
        date: li.lesson?.startsAt ? li.lesson.startsAt.toISOString().split('T')[0]! : null,
        teacher: li.lesson?.teacher ? `${li.lesson.teacher.firstName} ${li.lesson.teacher.lastName}` : null,
        student: li.lesson?.student ? `${li.lesson.student.firstName} ${li.lesson.student.lastName}` : null,
        instrument: li.lesson?.enrollment?.instrument ?? null,
      }))
      .sort((a, b) => {
        if (a.date && b.date) return a.date.localeCompare(b.date);
        if (a.date) return -1;
        if (b.date) return 1;
        return 0;
      });

    return {
      number: inv.number,
      total: inv.total,
      status: inv.status,
      dueDate: inv.dueDate,
      issuedOn: inv.issuedOn,
      notes: inv.notes,
      lineItems,
      family: family ? { name: family.name, address: family.address } : null,
      org: {
        name: org?.name ?? 'Music & Life',
        address: settings.address as string | undefined,
        bankSortCode: settings.bankSortCode as string | undefined,
        bankAccountNumber: settings.bankAccountNumber as string | undefined,
        bankAccountName: settings.bankAccountName as string | undefined,
        invoiceNotes: settings.invoiceNotes as string | undefined,
      },
    };
  }

  async createInvoice(orgId: string, dto: CreateInvoiceDto) {
    const family = await this.db.db.query.families.findFirst({
      where: and(eq(families.id, dto.familyId), eq(families.organizationId, orgId)),
    });
    if (!family) throw new NotFoundException('Family not found');

    const number = await this.nextInvoiceNumber(orgId);
    const today = new Date().toISOString().split('T')[0]!;

    // Honour the family's configured due-date offset instead of a hard-coded +7.
    // A monthly statement that still has the legacy default (7) gets ~30 days so
    // "a monthly invoice is due in about a month", which is what studios expect;
    // per-lesson invoices keep the shorter window. An explicitly-set offset is
    // always respected.
    const offsetDays =
      dto.mode === 'monthly_statement' && family.dueDateOffsetDays === 7
        ? 30
        : family.dueDateOffsetDays;
    const due = new Date(Date.now() + offsetDays * 86400000).toISOString().split('T')[0]!;

    // itemizeLessons is a control flag, not a column — keep it out of the insert.
    const { itemizeLessons, ...invoiceData } = dto;

    const [inv] = await this.db.db.insert(invoices).values({
      ...invoiceData,
      organizationId: orgId,
      number,
      issuedOn: today,
      dueDate: due,
      status: 'draft',
    }).returning();

    // Both monthly statements and per-lesson invoices itemise the period's
    // lessons (one line per lesson, with date/teacher/instrument derived at read
    // time). Previously only per_lesson itemised, so monthly statements came out
    // as an empty £0 shell — e.g. a family's weekly lessons never appeared. The
    // "custom amount" flow passes itemizeLessons=false to stay manual-only.
    if (itemizeLessons !== false) {
      await this.generateLessonLineItems(orgId, inv!.id, dto.familyId, dto.periodStart, dto.periodEnd);
      // generateLessonLineItems updates invoices.total to the itemised amount, but
      // `inv` is the pre-itemisation snapshot (total = the £0 insert default). Re-read
      // so callers see the real total — same as createInvoicesPerClass does. Without
      // this the auto-scheduler emailed every family "Invoice … for £0.00 is now
      // available" no matter how much they actually owed.
      const refreshed = await this.db.db.query.invoices.findFirst({
        where: eq(invoices.id, inv!.id),
      });
      if (refreshed) return refreshed;
    }

    return inv!;
  }

  // The family's completed lessons that haven't been billed on any invoice yet,
  // within the optional period, earliest-first. Shared by the combined statement
  // and the per-class split so the two can never disagree about what's eligible.
  private async getEligibleLessons(
    orgId: string, studentIds: string[], periodStart?: string, periodEnd?: string,
  ) {
    if (studentIds.length === 0) return [];

    const candidateLessons = await this.db.db.query.lessons.findMany({
      where: and(
        eq(lessons.organizationId, orgId),
        inArray(lessons.studentId, studentIds),
        eq(lessons.status, 'completed'),
      ),
      with: {
        teacher: { columns: { firstName: true, lastName: true } },
        enrollment: { columns: { instrument: true, rate: true, trialRate: true, defaultDuration: true, lessonType: true } },
      },
    });
    // No completed lessons → nothing to itemise. Returning here also avoids
    // calling inArray() with an empty list below, which builds invalid SQL.
    if (candidateLessons.length === 0) return [];

    const alreadyBilled = await this.db.db.query.invoiceLineItems.findMany({
      where: and(
        eq(invoiceLineItems.organizationId, orgId),
        inArray(invoiceLineItems.lessonId, candidateLessons.map(l => l.id)),
      ),
      columns: { lessonId: true },
      with: { invoice: { columns: { status: true } } },
    });
    // A voided invoice's line items are kept for history but its charge was
    // reversed, so its lessons are NOT billed — they must stay eligible, or
    // voiding an invoice to reissue it would leave those lessons permanently
    // un-billable and the corrected invoice would come out empty.
    const billedLessonIds = new Set(
      alreadyBilled
        .filter(i => i.invoice?.status !== 'void')
        .map(i => i.lessonId),
    );

    const start = periodStart ? new Date(periodStart) : null;
    const end = periodEnd ? new Date(`${periodEnd}T23:59:59`) : null;

    return candidateLessons
      .filter(l => !billedLessonIds.has(l.id))
      .filter(l => !start || l.startsAt >= start)
      .filter(l => !end || l.startsAt <= end)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  // Turn a set of eligible lessons into invoice line rows (one per lesson, with a
  // separate line for any overrun), then insert them and set the invoice total.
  // Returns the number of line rows written so a caller can drop an empty invoice.
  private async writeLessonLineItems(
    orgId: string,
    invoiceId: string,
    eligible: Awaited<ReturnType<typeof BillingService.prototype.getEligibleLessons>>,
  ): Promise<number> {
    if (eligible.length === 0) return 0;

    const rows = eligible.flatMap(l => {
      const instrument = l.enrollment?.instrument
        ? l.enrollment.instrument.charAt(0).toUpperCase() + l.enrollment.instrument.slice(1)
        : '';
      const kind = l.enrollment?.lessonType === 'group' ? 'group class' : 'lesson';
      const base = {
        organizationId: orgId,
        invoiceId,
        lessonId: l.id,
      };
      const rate = l.enrollment?.rate;
      const standard = l.enrollment?.defaultDuration;
      const trialRate = l.enrollment?.trialRate;
      const isGroup = l.enrollment?.lessonType === 'group';

      // Single source of truth for the fee — the exact amount the attendance
      // auto-charge already debited the family's balance (billing's
      // effectiveLessonAmount): a trial's flat intro price, a group class's flat
      // set price, or a prorated private rate. Computing the line any other way
      // (e.g. prorating a group class by its minutes) makes the statement
      // disagree with the running balance the family was actually charged.
      const total = effectiveLessonAmount({
        isTrialLesson: l.isTrialLesson,
        lessonType: l.enrollment?.lessonType,
        rate,
        trialRate,
        defaultDuration: standard,
        duration: l.duration,
      });

      // A trial with its own flat price bills a single, clearly-labelled line at
      // that price — no proration, no overrun split (a trial is a fixed offer).
      if (l.isTrialLesson && trialRate != null) {
        return [{
          ...base,
          description: [instrument, `trial ${kind} · ${l.duration} min`].filter(Boolean).join(' '),
          amount: total,
        }];
      }

      // A PRIVATE lesson that ran long is still charged pro-rata, but showing it
      // as one inflated line ("Piano lesson · 75 min — £56.25") invites the "why
      // is this more than usual?" email. Split the overrun onto its own line so
      // the bill explains itself. The overtime amount is the remainder rather
      // than a second prorate, so the two lines always sum to exactly the same
      // total. A group class is a flat set price regardless of a few minutes
      // over, so it never splits — it bills the flat rate, matching the charge.
      if (!isGroup && rate != null && standard && l.duration > standard) {
        const extra = l.duration - standard;
        return [
          {
            ...base,
            description: [instrument, `${kind} · ${standard} min`].filter(Boolean).join(' '),
            amount: rate,
          },
          {
            ...base,
            description: [instrument, `${kind} · ${extra} min extra time`].filter(Boolean).join(' '),
            amount: total - rate,
          },
        ];
      }

      return [{
        ...base,
        description: [instrument, `${kind} · ${l.duration} min`].filter(Boolean).join(' '),
        amount: total,
      }];
    });
    await this.db.db.insert(invoiceLineItems).values(rows);

    const total = rows.reduce((s, r) => s + r.amount, 0);
    await this.db.db.update(invoices).set({ total, updatedAt: new Date() }).where(eq(invoices.id, invoiceId));
    return rows.length;
  }

  // Itemises one line per completed, unbilled lesson for every student in the
  // family (the combined statement). Optionally scoped to a single enrolment,
  // which is how the per-class split bills one class at a time.
  private async generateLessonLineItems(
    orgId: string, invoiceId: string, familyId: string,
    periodStart?: string, periodEnd?: string, enrollmentId?: string,
  ) {
    const famStudents = await this.db.db.query.students.findMany({
      where: and(eq(students.organizationId, orgId), eq(students.familyId, familyId)),
      columns: { id: true },
    });
    let eligible = await this.getEligibleLessons(orgId, famStudents.map(s => s.id), periodStart, periodEnd);
    if (enrollmentId) eligible = eligible.filter(l => l.enrollmentId === enrollmentId);
    await this.writeLessonLineItems(orgId, invoiceId, eligible);
  }

  /**
   * Bill each class on its own invoice instead of one combined family statement.
   *
   * Groups the family's eligible lessons by enrolment (the "class" — a student's
   * instrument, private or group) and raises one invoice per class that has
   * anything to bill. A family with a child doing piano and cello gets two
   * invoices, each showing only that class's lessons — which is what studios that
   * bill instruments separately (or split group-class fees out) have asked for.
   *
   * Returns the invoices created (drafts, like a normal createInvoice), newest
   * first; the caller issues them the usual way.
   */
  async createInvoicesPerClass(orgId: string, dto: CreateInvoiceDto) {
    const family = await this.db.db.query.families.findFirst({
      where: and(eq(families.id, dto.familyId), eq(families.organizationId, orgId)),
      columns: { id: true },
    });
    if (!family) throw new NotFoundException('Family not found');

    const famStudents = await this.db.db.query.students.findMany({
      where: and(eq(students.organizationId, orgId), eq(students.familyId, dto.familyId)),
      columns: { id: true },
    });
    const eligible = await this.getEligibleLessons(
      orgId, famStudents.map(s => s.id), dto.periodStart, dto.periodEnd,
    );
    if (eligible.length === 0) {
      throw new BadRequestException('No unbilled lessons in this period to invoice.');
    }

    // Group eligible lessons by class (enrolment). Lessons with no enrolment are
    // skipped — they have no rate to bill and belong on a manual line, not here.
    const byClass = new Map<string, typeof eligible>();
    for (const l of eligible) {
      if (!l.enrollmentId) continue;
      const g = byClass.get(l.enrollmentId) ?? [];
      g.push(l);
      byClass.set(l.enrollmentId, g);
    }
    if (byClass.size === 0) {
      throw new BadRequestException('No class lessons in this period to invoice.');
    }

    const created: Array<{ id: string; number: string; total: number }> = [];
    for (const group of byClass.values()) {
      // itemizeLessons:false so createInvoice makes an empty shell we fill with
      // just this class's lessons.
      const inv = await this.createInvoice(orgId, { ...dto, itemizeLessons: false });
      await this.writeLessonLineItems(orgId, inv.id, group);
      const refreshed = await this.db.db.query.invoices.findFirst({
        where: eq(invoices.id, inv.id), columns: { id: true, number: true, total: true },
      });
      if (refreshed) created.push(refreshed);
    }

    return { invoices: created };
  }

  async sendInvoice(orgId: string, id: string) {
    const inv = await this.getInvoice(orgId, id);
    // Only a draft can be issued. Without this, re-sending an already-sent
    // invoice was a no-op (fine), but re-sending a VOIDED one flipped it back
    // to 'sent' and, since its status wasn't 'sent' yet, syncManualInvoiceCharge
    // posted a brand-new charge for an invoice that was supposed to be
    // cancelled — a stale "Send" click double-billed the family. It also let a
    // 'paid' invoice be silently downgraded back to 'sent', hiding that it was
    // settled.
    if (inv.status !== 'draft') {
      throw new BadRequestException(`This invoice is already ${inv.status} and cannot be sent again.`);
    }
    // An invoice with nothing on it is not a bill. Issuing one put a £0.00
    // "Invoice due" in front of a family with no way to act on it, and left
    // staff wondering why the balance never moved. Say so at the point of
    // issue rather than shipping the confusion downstream.
    if (inv.total === 0) {
      throw new BadRequestException(
        'This invoice totals £0.00. Add at least one line item before issuing it.',
      );
    }
    // A negative total is a credit, not a bill. Issuing it as a "sent" invoice
    // put a payable in front of a family that owes nothing (the pay page even
    // showed "Total due -£4.00"). Refuse it at the point of issue: adjust the
    // line items so the invoice is zero-or-positive, or apply the credit to the
    // family's balance instead of dressing it up as an invoice.
    if (inv.total < 0) {
      throw new BadRequestException(
        'This invoice totals a credit (less than £0.00), so it cannot be issued as a bill. '
        + 'Adjust the line items, or apply the credit to the family balance instead.',
      );
    }
    const [updated] = await this.db.db.update(invoices)
      .set({ status: 'sent', updatedAt: new Date() })
      .where(and(eq(invoices.id, id), eq(invoices.organizationId, orgId)))
      .returning();
    // Issuing the invoice is what puts the money on the family's account.
    await this.syncManualInvoiceCharge(orgId, id);
    return updated!;
  }

  /**
   * Post a ledger charge for an invoice's MANUAL lines — the ones with no
   * lessonId.
   *
   * Lesson lines are deliberately excluded: attendance already posted a charge
   * for each of those via postAutoCharge, and charging again here would bill
   * the family twice for the same lesson. Manual lines had no such counterpart,
   * so nothing ever debited the family for them: a hand-raised invoice left the
   * balance untouched, and paying it pushed the family into credit by the full
   * invoice amount (proved live — a settled £42.75 invoice left a lone
   * `payment 4275` entry and a +£42.75 balance).
   *
   * Reconciling rather than one-shot: it re-runs whenever the invoice is issued
   * or its lines change, so the single charge entry always equals the current
   * manual total.
   */
  private async syncManualInvoiceCharge(orgId: string, invoiceId: string) {
    await this.db.db.transaction(async (tx) => {
      const inv = await tx.query.invoices.findFirst({
        where: and(eq(invoices.id, invoiceId), eq(invoices.organizationId, orgId)),
        columns: { id: true, familyId: true },
      });
      if (!inv) return;

      const existing = await tx.query.ledgerEntries.findFirst({
        where: and(
          eq(ledgerEntries.organizationId, orgId),
          eq(ledgerEntries.type, 'charge'),
          eq(ledgerEntries.invoiceId, invoiceId),
        ),
      });

      const items = await tx.query.invoiceLineItems.findMany({
        where: eq(invoiceLineItems.invoiceId, invoiceId),
        columns: { amount: true, lessonId: true },
      });
      const amount = -items.filter(i => !i.lessonId).reduce((s, i) => s + i.amount, 0);

      // Nothing to post, and nothing posted before → done.
      if (amount === 0 && !existing) return;
      // Already correct — this runs on every send and line-item edit.
      if (existing && existing.amount === amount) return;

      // Lock the family row so a concurrent payment can't clobber the balance.
      const [family] = await tx.select({ balanceCached: families.balanceCached }).from(families)
        .where(and(eq(families.id, inv.familyId), eq(families.organizationId, orgId)))
        .for('update');
      if (!family) return;

      // Back out whatever was posted before, then post the current total, so a
      // line added or edited after the invoice was issued stays in step.
      const balanceWithoutCharge = family.balanceCached - (existing?.amount ?? 0);
      const newBalance = balanceWithoutCharge + amount;

      if (existing && amount === 0) {
        await tx.delete(ledgerEntries).where(eq(ledgerEntries.id, existing.id));
      } else if (existing) {
        await tx.update(ledgerEntries)
          .set({ amount, balanceAfter: newBalance })
          .where(eq(ledgerEntries.id, existing.id));
      } else {
        await tx.insert(ledgerEntries).values({
          organizationId: orgId,
          familyId: inv.familyId,
          type: 'charge',
          amount,
          balanceAfter: newBalance,
          invoiceId,
          description: 'Invoice charge',
        });
      }

      await tx.update(families)
        .set({ balanceCached: newBalance, updatedAt: new Date() })
        .where(eq(families.id, inv.familyId));
    });
  }

  async voidInvoice(orgId: string, id: string) {
    const inv = await this.getInvoice(orgId, id);
    if (inv.status === 'paid') throw new BadRequestException('Cannot void a paid invoice');
    const [updated] = await this.db.db.update(invoices)
      .set({ status: 'void', updatedAt: new Date() })
      .where(eq(invoices.id, id))
      .returning();
    // Cancelling the invoice has to take its charge back off the account, or
    // the family keeps owing for something that no longer exists.
    await this.reverseManualInvoiceCharge(orgId, id);
    return updated!;
  }

  private async reverseManualInvoiceCharge(orgId: string, invoiceId: string) {
    await this.db.db.transaction(async (tx) => {
      const charge = await tx.query.ledgerEntries.findFirst({
        where: and(
          eq(ledgerEntries.organizationId, orgId),
          eq(ledgerEntries.type, 'charge'),
          eq(ledgerEntries.invoiceId, invoiceId),
        ),
      });
      if (!charge) return;

      const [family] = await tx.select({ balanceCached: families.balanceCached }).from(families)
        .where(and(eq(families.id, charge.familyId), eq(families.organizationId, orgId)))
        .for('update');
      if (!family) return;

      // Deleting rather than posting a counter-entry keeps the family's ledger
      // readable — the charge never should have stood.
      await tx.delete(ledgerEntries).where(eq(ledgerEntries.id, charge.id));
      await tx.update(families)
        .set({ balanceCached: family.balanceCached - charge.amount, updatedAt: new Date() })
        .where(eq(families.id, charge.familyId));
    });
  }

  async addLineItem(orgId: string, invoiceId: string, description: string, amount: number, lessonId?: string) {
    const target = await this.getInvoice(orgId, invoiceId);
    // A line added to a 'paid' invoice bumped invoices.total without ever
    // charging the family the extra amount (syncManualInvoiceCharge only ran
    // for 'sent'), so the invoice showed a bigger total while still reading
    // "Paid" — the shortfall was never posted anywhere. On a 'void' invoice it
    // resurrected a total on something that was supposed to be cancelled. Both
    // are dead ends once the invoice has left 'draft'/'sent'; the line just
    // needs a new invoice instead.
    if (target.status === 'paid' || target.status === 'void') {
      throw new BadRequestException(`This invoice is ${target.status} and can no longer be edited.`);
    }
    // An optional lessonId is a caller-supplied FK: a bogus id 500s on the
    // constraint and a foreign-org id would bill against another studio's lesson.
    if (lessonId) {
      const lesson = await this.db.db.query.lessons.findFirst({
        where: and(eq(lessons.id, lessonId), eq(lessons.organizationId, orgId)),
        columns: { id: true },
      });
      if (!lesson) throw new NotFoundException('Lesson not found');
    }
    const [item] = await this.db.db.insert(invoiceLineItems).values({
      organizationId: orgId, invoiceId, description, amount, lessonId,
    }).returning();

    const items = await this.db.db.query.invoiceLineItems.findMany({
      where: eq(invoiceLineItems.invoiceId, invoiceId),
    });
    const total = items.reduce((s, i) => s + i.amount, 0);
    await this.db.db.update(invoices).set({ total, updatedAt: new Date() }).where(eq(invoices.id, invoiceId));

    // A line added to an already-issued invoice has to move the balance too;
    // on a draft this is a no-op until the invoice is sent.
    const inv = await this.db.db.query.invoices.findFirst({
      where: eq(invoices.id, invoiceId), columns: { status: true },
    });
    if (inv?.status === 'sent') await this.syncManualInvoiceCharge(orgId, invoiceId);

    return item!;
  }

  /**
   * Edit or remove a manually-added line item. Lesson-generated lines aren't
   * touched here — they're documentation of a calendar-driven charge, not
   * something to hand-edit — so both guard on lessonId being null the same way
   * the UI only offers these actions on manual rows.
   */
  private async assertEditableManualLineItem(orgId: string, invoiceId: string, lineItemId: string) {
    const inv = await this.db.db.query.invoices.findFirst({
      where: and(eq(invoices.id, invoiceId), eq(invoices.organizationId, orgId)),
      columns: { status: true },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.status === 'paid' || inv.status === 'void') {
      throw new BadRequestException(`This invoice is ${inv.status} and can no longer be edited.`);
    }
    const item = await this.db.db.query.invoiceLineItems.findFirst({
      where: and(eq(invoiceLineItems.id, lineItemId), eq(invoiceLineItems.invoiceId, invoiceId)),
    });
    if (!item) throw new NotFoundException('Line item not found');
    if (item.lessonId) throw new BadRequestException('Lesson-generated line items can’t be edited here.');
    return { inv, item };
  }

  private async recomputeInvoiceTotal(orgId: string, invoiceId: string) {
    const items = await this.db.db.query.invoiceLineItems.findMany({
      where: eq(invoiceLineItems.invoiceId, invoiceId),
    });
    const total = items.reduce((s, i) => s + i.amount, 0);
    await this.db.db.update(invoices).set({ total, updatedAt: new Date() }).where(eq(invoices.id, invoiceId));
    const inv = await this.db.db.query.invoices.findFirst({
      where: eq(invoices.id, invoiceId), columns: { status: true },
    });
    if (inv?.status === 'sent') await this.syncManualInvoiceCharge(orgId, invoiceId);
  }

  async updateLineItem(orgId: string, invoiceId: string, lineItemId: string, description: string, amount: number) {
    await this.assertEditableManualLineItem(orgId, invoiceId, lineItemId);
    await this.db.db.update(invoiceLineItems).set({ description, amount })
      .where(eq(invoiceLineItems.id, lineItemId));
    await this.recomputeInvoiceTotal(orgId, invoiceId);
  }

  async removeLineItem(orgId: string, invoiceId: string, lineItemId: string) {
    await this.assertEditableManualLineItem(orgId, invoiceId, lineItemId);
    await this.db.db.delete(invoiceLineItems).where(eq(invoiceLineItems.id, lineItemId));
    await this.recomputeInvoiceTotal(orgId, invoiceId);
  }

  // ─── Bill one specific lesson directly ───────────────────────────────────────
  /**
   * Invoice exactly the lesson the caller is looking at, right now — from the
   * lesson-details view, not the period-based monthly/per-lesson itemiser.
   * That itemiser only ever pulls lessons already marked 'completed' (i.e.
   * attendance taken) within a date window, so aiming it at "just this one
   * lesson" via a same-day period silently came back empty — and empty invoice
   * issuing then failed with "£0.00" — whenever the lesson hadn't had
   * attendance marked yet. This bills the lesson by id instead, independent of
   * its attendance/status, since the admin explicitly chose to bill it.
   *
   * `settleMethod` set means the family paid in person (cash/bank transfer) —
   * for a family that never opens the portal — and the invoice is immediately
   * marked paid; omitted just emails the invoice, still outstanding.
   */
  async billLessonDirectly(orgId: string, lessonId: string, settleMethod?: 'cash' | 'bank_transfer') {
    const lesson = await this.db.db.query.lessons.findFirst({
      where: and(eq(lessons.id, lessonId), eq(lessons.organizationId, orgId)),
      with: {
        enrollment: { columns: { instrument: true, rate: true, trialRate: true, defaultDuration: true, lessonType: true } },
        student: { columns: { id: true }, with: { family: { columns: { id: true } } } },
      },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');

    const familyId = (lesson.student as { family?: { id: string } } | null)?.family?.id;
    if (!familyId) throw new BadRequestException('This lesson has no family to bill.');
    if (!lesson.enrollmentId || !lesson.enrollment) {
      throw new BadRequestException('This lesson is not linked to an enrolment, so it has no fee to bill.');
    }

    // Already on a real (non-void) invoice — refuse the double-bill rather
    // than silently raising a second charge for the same lesson.
    const already = await this.db.db.query.invoiceLineItems.findFirst({
      where: and(eq(invoiceLineItems.organizationId, orgId), eq(invoiceLineItems.lessonId, lessonId)),
      with: { invoice: { columns: { number: true, status: true } } },
    });
    if (already?.invoice && already.invoice.status !== 'void') {
      throw new BadRequestException(`This lesson is already on invoice ${already.invoice.number}.`);
    }

    const amount = effectiveLessonAmount({
      isTrialLesson: lesson.isTrialLesson,
      lessonType: lesson.enrollment.lessonType,
      rate: lesson.enrollment.rate,
      trialRate: lesson.enrollment.trialRate,
      defaultDuration: lesson.enrollment.defaultDuration,
      duration: lesson.duration,
    });
    if (amount <= 0) throw new BadRequestException('This lesson has no fee to bill.');

    const idempotencyKey = `bl-${lessonId}`;
    const priorPayment = settleMethod
      ? await this.db.db.query.payments.findFirst({
          where: and(eq(payments.idempotencyKey, idempotencyKey), eq(payments.organizationId, orgId)),
          columns: { invoiceId: true },
        })
      : null;
    if (priorPayment?.invoiceId) {
      const inv = await this.db.db.query.invoices.findFirst({
        where: eq(invoices.id, priorPayment.invoiceId), columns: { id: true, number: true, total: true },
      });
      return { invoiceId: inv?.id ?? null, invoiceNumber: inv?.number ?? null, amount: inv?.total ?? amount, status: 'paid' as const, alreadyPaid: true };
    }

    const inv = await this.createInvoice(orgId, { familyId, mode: 'per_lesson', itemizeLessons: false });
    const instrument = lesson.enrollment.instrument
      ? lesson.enrollment.instrument.charAt(0).toUpperCase() + lesson.enrollment.instrument.slice(1)
      : '';
    const isTrialPriced = !!lesson.isTrialLesson && lesson.enrollment.trialRate != null;
    const kind = `${isTrialPriced ? 'trial ' : ''}${lesson.enrollment.lessonType === 'group' ? 'group class' : 'lesson'}`;
    const description = [instrument, `${kind} · ${lesson.duration} min`].filter(Boolean).join(' ');
    await this.addLineItem(orgId, inv.id, description, amount, lessonId);
    await this.sendInvoice(orgId, inv.id);

    if (settleMethod) {
      await this.recordPayment(orgId, {
        familyId, invoiceId: inv.id, method: settleMethod, amount,
        notes: 'Paid in person', idempotencyKey,
      });
      return { invoiceId: inv.id, invoiceNumber: inv.number, amount, status: 'paid' as const };
    }

    return { invoiceId: inv.id, invoiceNumber: inv.number, amount, status: 'sent' as const };
  }

  // ─── Paid at the lesson ──────────────────────────────────────────────────────
  /**
   * Record that a family paid for a single lesson on the spot (cash/card at the
   * door), producing a paid per-lesson invoice as their receipt.
   *
   * The money model is deliberate. Attendance is the ONLY thing that charges a
   * lesson (postAutoCharge posts the debit when it's marked present); an invoice
   * line that carries a lessonId is documentation and never charges again. So
   * "paid at lesson" must not raise its own charge — it records a PAYMENT that
   * cancels the attendance charge, leaving the family's balance where it should
   * be (charge −A + payment +A = 0) with a paid invoice to show for it.
   *
   * Guards: the lesson must be marked present (so the charge it pays actually
   * exists), and a lesson already covered by a prepaid credit is refused (the
   * family has paid for it once already — taking cash too would double-charge
   * them). Idempotent per lesson, so a double-tap records exactly one payment.
   */
  async payForLesson(
    orgId: string,
    lessonId: string,
    method: 'cash' | 'card' | 'bank_transfer' | 'other',
  ) {
    const lesson = await this.db.db.query.lessons.findFirst({
      where: and(eq(lessons.id, lessonId), eq(lessons.organizationId, orgId)),
      with: {
        enrollment: { columns: { instrument: true, rate: true, trialRate: true, defaultDuration: true, lessonType: true } },
        student: { columns: { id: true }, with: { family: { columns: { id: true } } } },
      },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');

    const familyId = (lesson.student as { family?: { id: string } } | null)?.family?.id;
    if (!familyId) throw new BadRequestException('This lesson has no family to bill.');
    if (!lesson.enrollmentId || !lesson.enrollment) {
      throw new BadRequestException('This lesson is not linked to an enrolment, so it has no fee to take.');
    }

    // Only a lesson that actually happened is "paid at the lesson". Requiring the
    // present mark also guarantees the matching charge exists to be cancelled.
    const att = await this.db.db.query.attendance.findFirst({
      where: and(eq(attendance.organizationId, orgId), eq(attendance.lessonId, lessonId)),
      columns: { status: true },
    });
    if (att?.status !== 'present') {
      throw new BadRequestException('Mark the lesson as present before recording a payment at the lesson.');
    }

    // A lesson a prepaid credit already covered has no cash to take.
    const creditUsed = await this.db.db.query.lessonCredits.findFirst({
      where: and(eq(lessonCredits.organizationId, orgId), eq(lessonCredits.usedInLessonId, lessonId)),
      columns: { id: true },
    });
    if (creditUsed) {
      throw new BadRequestException('This lesson was covered by a prepaid credit — there is nothing to pay.');
    }

    const amount = effectiveLessonAmount({
      isTrialLesson: lesson.isTrialLesson,
      lessonType: lesson.enrollment.lessonType,
      rate: lesson.enrollment.rate,
      trialRate: lesson.enrollment.trialRate,
      defaultDuration: lesson.enrollment.defaultDuration,
      duration: lesson.duration,
    });
    if (amount <= 0) throw new BadRequestException('This lesson has no fee to take.');

    // Idempotent per lesson: a second tap returns the invoice the first one paid,
    // rather than raising a duplicate invoice and payment.
    const idempotencyKey = `pal-${lessonId}`;
    const priorPayment = await this.db.db.query.payments.findFirst({
      where: and(eq(payments.idempotencyKey, idempotencyKey), eq(payments.organizationId, orgId)),
      columns: { invoiceId: true },
    });
    if (priorPayment) {
      const inv = priorPayment.invoiceId
        ? await this.db.db.query.invoices.findFirst({
            where: eq(invoices.id, priorPayment.invoiceId),
            columns: { id: true, number: true, total: true },
          })
        : null;
      return {
        invoiceId: inv?.id ?? null,
        invoiceNumber: inv?.number ?? null,
        amount: inv?.total ?? amount,
        status: 'paid' as const,
        alreadyPaid: true,
      };
    }

    // One per-lesson invoice, one line carrying the lessonId (documentation only —
    // no charge is posted, since the lesson line references a real lesson).
    const inv = await this.createInvoice(orgId, { familyId, mode: 'per_lesson', itemizeLessons: false });
    const instrument = lesson.enrollment.instrument
      ? lesson.enrollment.instrument.charAt(0).toUpperCase() + lesson.enrollment.instrument.slice(1)
      : '';
    const isTrialPriced = !!lesson.isTrialLesson && lesson.enrollment.trialRate != null;
    const kind = `${isTrialPriced ? 'trial ' : ''}${lesson.enrollment.lessonType === 'group' ? 'group class' : 'lesson'}`;
    const description = [instrument, `${kind} · ${lesson.duration} min — paid at the lesson`].filter(Boolean).join(' ');
    await this.addLineItem(orgId, inv.id, description, amount, lessonId);
    await this.sendInvoice(orgId, inv.id);

    // The payment cancels the attendance charge and marks the invoice paid.
    await this.recordPayment(orgId, {
      familyId,
      invoiceId: inv.id,
      method,
      amount,
      notes: 'Paid at the lesson',
      idempotencyKey,
    });

    return { invoiceId: inv.id, invoiceNumber: inv.number, amount, status: 'paid' as const };
  }

  // ─── Resource-library subscription ──────────────────────────────────────────
  // The studio sells access to the shared resource library as a subscription,
  // billed separately from lessons. Price (pence) and period (months) live in
  // org settings so the studio can change them; these are the defaults if unset.
  static readonly RESOURCE_SUB_DEFAULT_PRICE = 600; // £6.00 per period
  static readonly RESOURCE_SUB_DEFAULT_MONTHS = 1;
  // Stable prefix of a resource-subscription invoice's line item. Used both to
  // label the charge and to recognise an already-outstanding one (there is no
  // dedicated invoice "kind" column), so the two must stay in sync.
  static readonly RESOURCE_SUB_LABEL_PREFIX = 'Resource library access';

  async getResourceSubscriptionTerms(orgId: string): Promise<{ price: number; months: number }> {
    const org = await this.db.db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
      columns: { settings: true },
    });
    const cfg = (org?.settings ?? {}) as Record<string, unknown>;
    const rawPrice = Number(cfg.resourceSubscriptionPrice);
    const rawMonths = Number(cfg.resourceSubscriptionMonths);
    // A configured value wins; anything missing or nonsensical falls back to the
    // default so a family is never quoted £0 or a negative period.
    const price = Number.isFinite(rawPrice) && rawPrice > 0
      ? Math.round(rawPrice) : BillingService.RESOURCE_SUB_DEFAULT_PRICE;
    const months = Number.isInteger(rawMonths) && rawMonths > 0
      ? rawMonths : BillingService.RESOURCE_SUB_DEFAULT_MONTHS;
    return { price, months };
  }

  /**
   * Charge a family for a resource-library subscription and extend their access.
   *
   * Mirrors how lessons are billed: the service is granted now and an invoice is
   * raised for it, which the family settles by the usual bank-transfer + claim
   * flow. Renewing part-way through stacks the new period onto whatever time is
   * left rather than throwing it away.
   */
  async chargeResourceSubscription(orgId: string, familyId: string) {
    const { price, months } = await this.getResourceSubscriptionTerms(orgId);

    // The whole check-then-act runs inside one transaction, row-locking the
    // family first. Without this, the idempotency guard below (checking for an
    // already-outstanding subscription invoice) was a plain read: a double-tap,
    // two open tabs, or a back-button re-POST could both read "no outstanding
    // invoice" before either had inserted one, raising two invoices (and two
    // emails) and stacking the paid-until period twice for one intent. `.for
    // ('update')` serialises concurrent callers on this family exactly like
    // syncManualInvoiceCharge does for a ledger charge. createInvoice/addLineItem
    // /sendInvoice all write through `this.db.db`, so a scoped copy of `this`
    // whose db is the open transaction is used to call them, keeping their
    // inserts inside the same lock instead of a separate connection that
    // wouldn't be serialised by it.
    return this.db.db.transaction(async (tx) => {
      const [family] = await tx.select({ id: families.id, resourceAccessPaidUntil: families.resourceAccessPaidUntil })
        .from(families)
        .where(and(eq(families.id, familyId), eq(families.organizationId, orgId)))
        .for('update');
      if (!family) throw new NotFoundException('Family not found');

      // Idempotency guard. Access is granted the moment the invoice is issued
      // (paid later by bank transfer), so if an unpaid resource-subscription
      // invoice already exists we return it rather than charging again. Once
      // that invoice is reconciled to 'paid', a genuine renewal is allowed
      // through. There is no invoice "kind" column, so the subscription invoice
      // is recognised by its line-item label prefix.
      const outstanding = await tx.query.invoices.findMany({
        where: and(
          eq(invoices.organizationId, orgId),
          eq(invoices.familyId, familyId),
          eq(invoices.status, 'sent'),
        ),
        columns: { id: true, number: true },
        with: { lineItems: { columns: { description: true } } },
      });
      const alreadyPending = outstanding.find(inv =>
        inv.lineItems.some(li => li.description.startsWith(BillingService.RESOURCE_SUB_LABEL_PREFIX)),
      );
      if (alreadyPending) {
        return {
          paidUntil: family.resourceAccessPaidUntil ?? null,
          invoiceId: alreadyPending.id,
          invoiceNumber: alreadyPending.number,
          price, months, alreadyPending: true,
        };
      }

      const scoped: this = Object.create(this, { db: { value: { db: tx } } });

      // One manual invoice, one line, issued so it lands on the family's account.
      const inv = await scoped.createInvoice(orgId, {
        familyId, mode: 'monthly_statement', itemizeLessons: false,
      });
      const label = `${BillingService.RESOURCE_SUB_LABEL_PREFIX} — ${months} month${months === 1 ? '' : 's'}`;
      await scoped.addLineItem(orgId, inv.id, label, price);
      await scoped.sendInvoice(orgId, inv.id);

      // Extend from the later of today or the current expiry.
      const todayStr = new Date().toISOString().split('T')[0]!;
      const stillActive = family.resourceAccessPaidUntil && family.resourceAccessPaidUntil >= todayStr;
      const base = stillActive ? new Date(family.resourceAccessPaidUntil!) : new Date(todayStr);
      base.setMonth(base.getMonth() + months);
      const paidUntil = base.toISOString().split('T')[0]!;

      await tx.update(families)
        .set({ resourceAccessPaidUntil: paidUntil, updatedAt: new Date() })
        .where(and(eq(families.id, familyId), eq(families.organizationId, orgId)));

      return { paidUntil, invoiceId: inv.id, invoiceNumber: inv.number, price, months };
    });
  }

  // ─── Ledger ────────────────────────────────────────────────────────────────
  async getLedger(orgId: string, familyId: string) {
    const family = await this.db.db.query.families.findFirst({
      where: and(eq(families.id, familyId), eq(families.organizationId, orgId)),
    });
    if (!family) throw new NotFoundException('Family not found');

    const entries = await this.db.db.query.ledgerEntries.findMany({
      where: and(eq(ledgerEntries.organizationId, orgId), eq(ledgerEntries.familyId, familyId)),
      with: { invoice: { columns: { id: true, number: true } } },
      orderBy: (e, { desc }) => [desc(e.occurredAt)],
    });

    return { familyId, balance: family.balanceCached, entries };
  }

  // Preview the family's balance as of a given date (defaults to today) — lets a parent or
  // admin look ahead/back without waiting for an invoice. Sums ledger entries up to that
  // date rather than relying on the always-current `balanceCached`.
  async getBalanceAsOf(orgId: string, familyId: string, asOf: string) {
    const family = await this.db.db.query.families.findFirst({
      where: and(eq(families.id, familyId), eq(families.organizationId, orgId)),
    });
    if (!family) throw new NotFoundException('Family not found');

    const cutoff = new Date(`${asOf}T23:59:59.999`);
    const entries = await this.db.db.query.ledgerEntries.findMany({
      where: and(eq(ledgerEntries.organizationId, orgId), eq(ledgerEntries.familyId, familyId)),
      orderBy: (e, { asc }) => [asc(e.occurredAt)],
    });

    const upToDate = entries.filter(e => e.occurredAt <= cutoff);
    const balance = upToDate.reduce((sum, e) => sum + e.amount, 0);

    return { familyId, asOf, balance, entries: upToDate };
  }

  // ─── Payments ──────────────────────────────────────────────────────────────
  async recordPayment(orgId: string, dto: RecordPaymentDto) {
    // De-dupe key: explicit client key wins, then a provider reference. Cash/card
    // with neither gets a per-request key (no cross-request de-dupe possible).
    const dedupeKey = dto.idempotencyKey ?? (dto.providerRef ? `${dto.method}-${dto.providerRef}` : undefined);

    // Fast path: this exact payment was already recorded → return it, don't double-post.
    if (dedupeKey) {
      const existing = await this.db.db.query.payments.findFirst({
        where: and(eq(payments.idempotencyKey, dedupeKey), eq(payments.organizationId, orgId)),
      });
      if (existing) return existing;
    }

    let payment;
    try {
      payment = await this.db.db.transaction(async (tx) => {
        // Lock the family row for the duration of the txn so two concurrent
        // payments can't both read the same balanceCached and clobber each other
        // (lost update). The second waits here until the first commits.
        const [family] = await tx.select().from(families)
          .where(and(eq(families.id, dto.familyId), eq(families.organizationId, orgId)))
          .for('update');
        if (!family) throw new NotFoundException('Family not found');

        // Validate the optional invoiceId belongs to this org AND this family
        // before it reaches the payment insert. Without this a bogus id 500s on
        // the FK constraint and a valid id from another family/studio would be
        // stored as a cross-referenced payment.
        if (dto.invoiceId) {
          const invOwned = await tx.query.invoices.findFirst({
            where: and(
              eq(invoices.id, dto.invoiceId),
              eq(invoices.organizationId, orgId),
              eq(invoices.familyId, dto.familyId),
            ),
            columns: { id: true },
          });
          if (!invOwned) throw new NotFoundException('Invoice not found');
        }

        // Guard against duplicate payments on an already-settled invoice — but
        // ONLY for a payment with no independent proof it's a distinct real
        // transaction (no providerRef). A manual/cash entry with no dedupeKey
        // can't be told apart from a receptionist's accidental double-click, so
        // for THOSE it's correct to assume "already recorded" and return the
        // prior payment instead of inserting again (closes that race since the
        // locked family row serialises concurrent calls through here).
        //
        // A payment WITH a providerRef (a card gateway, if one is ever added
        // back) is different: dto.providerRef is independently verified by
        // re-fetching from the provider, and it already passed the fast-path
        // dedupeKey check above — meaning THIS is a genuinely different, real,
        // distinct transaction, not a retry of the one that just paid the
        // invoice. Two open tabs / two devices can each complete a real card
        // charge before either webhook lands; the second charge is real money
        // the family's card was actually billed. Treating it as "already paid,
        // discard" here silently dropped that charge with NO payment row, NO
        // ledger entry, and NO record anywhere that a second payment ever
        // happened — the money vanished from the app's books while still
        // sitting captured at the gateway. It must still be
        // recorded (as a credit to the family's balance, same as any
        // overpayment) even though the invoice itself is already settled; the
        // status-flip logic further below already no-ops once status is 'paid',
        // so falling through here does not re-trigger "invoice paid" effects.
        if (dto.invoiceId && !dto.providerRef) {
          const inv = await tx.query.invoices.findFirst({
            where: and(eq(invoices.id, dto.invoiceId), eq(invoices.organizationId, orgId)),
          });
          if (inv && inv.status === 'paid') {
            const prior = await tx.query.payments.findFirst({
              where: and(eq(payments.invoiceId, dto.invoiceId), eq(payments.organizationId, orgId)),
              orderBy: (p, { desc }) => [desc(p.createdAt)],
            });
            if (prior) return prior;
            throw new ConflictException('This invoice has already been paid.');
          }
        }

        const [created] = await tx.insert(payments).values({
          ...dto,
          organizationId: orgId,
          // Unique column enforces exactly-once even if two requests race past the
          // fast-path check above (second insert violates the constraint → caught below).
          idempotencyKey: dedupeKey ?? `pay-${dto.familyId}-${Date.now()}`,
        }).returning();

        const newBalance = family.balanceCached + dto.amount;
        await tx.insert(ledgerEntries).values({
          organizationId: orgId,
          familyId: dto.familyId,
          type: 'payment',
          amount: dto.amount,
          balanceAfter: newBalance,
          invoiceId: dto.invoiceId,
          description: `Payment via ${dto.method}${dto.providerRef ? ` (ref: ${dto.providerRef})` : ''}`,
        });

        await tx.update(families)
          .set({ balanceCached: newBalance, updatedAt: new Date() })
          .where(eq(families.id, dto.familyId));

        if (dto.invoiceId) {
          // Scope the invoice to THIS org and THIS payment's family. Without the
          // family/org filter a payment recorded for one family could flip an
          // unrelated invoice (another family's, or another tenant's) to 'paid'
          // whenever the amount covered its total — the money lands on the payer
          // while someone else's invoice is marked settled.
          const inv = await tx.query.invoices.findFirst({
            where: and(
              eq(invoices.id, dto.invoiceId),
              eq(invoices.organizationId, orgId),
              eq(invoices.familyId, dto.familyId),
            ),
          });
          // Mark paid on the CUMULATIVE total paid against the invoice, not just
          // this one payment. Two part-payments (£30 then £20 on a £50 invoice)
          // fully settle it, but comparing a single `dto.amount` to the total
          // left the invoice stuck 'sent' forever — so it still showed as
          // outstanding, kept drawing dunning reminders and inflated the
          // outstanding-invoices KPI, even though the family owed nothing. The
          // just-inserted payment is already in this txn, so it's counted here.
          if (inv && inv.status !== 'void' && inv.status !== 'paid') {
            const [paid] = await tx.select({ total: sum(payments.amount) })
              .from(payments)
              .where(and(
                eq(payments.invoiceId, dto.invoiceId),
                eq(payments.organizationId, orgId),
              ));
            if (Number(paid?.total ?? 0) >= inv.total) {
              await tx.update(invoices)
                .set({ status: 'paid', updatedAt: new Date() })
                .where(eq(invoices.id, dto.invoiceId));
            }
          }
        }

        return created!;
      });
    } catch (err) {
      // Two identical requests raced: the loser's insert hit the unique idempotency
      // key. Return the payment the winner recorded rather than erroring.
      if (dedupeKey && this.isUniqueViolation(err)) {
        const existing = await this.db.db.query.payments.findFirst({
          where: and(eq(payments.idempotencyKey, dedupeKey), eq(payments.organizationId, orgId)),
        });
        if (existing) return existing;
      }
      throw err;
    }

    // Payments not tied to a specific invoice are prepaid top-ups → auto-issue
    // lesson credits. Runs after the payment transaction commits.
    if (!dto.invoiceId) {
      this.allocatePaymentToCredits(orgId, dto.familyId, payment.id, dto.amount)
        .catch(err => this.logger.warn(`Credit allocation failed for payment ${payment.id}: ${err}`));
    }

    this.sendReceipt(orgId, payment)
      .catch(err => this.logger.warn(`Receipt email failed for payment ${payment.id}: ${err}`));

    return payment;
  }

  // A receipt for every settled payment, regardless of how it landed — a
  // staff member recording cash/bank transfer at the desk, a bank statement
  // auto-matching a family's self-claimed transfer, or pay-at-lesson. Some
  // families never open the invoice itself, so this is self-contained.
  private async sendReceipt(orgId: string, payment: { id: string; familyId: string; amount: number; method: string; invoiceId: string | null; createdAt: Date }) {
    const family = await this.db.db.query.families.findFirst({
      where: eq(families.id, payment.familyId),
      columns: { email: true, contactName: true, name: true },
    });
    const email = family?.email?.trim();
    if (!email) return;

    const inv = payment.invoiceId
      ? await this.db.db.query.invoices.findFirst({ where: eq(invoices.id, payment.invoiceId), columns: { number: true } })
      : null;

    const amount = `£${(payment.amount / 100).toFixed(2)}`;
    const methodLabel = payment.method.replace(/_/g, ' ');
    const date = payment.createdAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const lines = [
      `<strong>Amount:</strong> ${amount}`,
      `<strong>Method:</strong> ${methodLabel}`,
      `<strong>Date:</strong> ${date}`,
      inv ? `<strong>Invoice:</strong> ${inv.number}` : null,
      `<strong>Reference:</strong> ${payment.id}`,
    ].filter(Boolean);
    const body = lines.map(l => `<p style="margin:0 0 4px">${l}</p>`).join('');

    await this.notifications.trigger('payment.receipt', { orgId, email, body });
  }

  // Postgres unique-violation SQLSTATE is 23505 (surfaced by postgres-js on err.code).
  private isUniqueViolation(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
  }

  // ─── Credit allocation ────────────────────────────────────────────────────
  /**
   * When a prepaid (on-account) payment arrives, convert the money the studio is
   * now holding for the family into whole prepaid lessons, split across their
   * active students proportionally by lesson rate.
   *
   * The convertible pot is the family's POSITIVE balance after the payment — not
   * the raw payment amount — so a payment that first clears an outstanding charge
   * only banks the genuine surplus, and a family already in debt never receives
   * lessons they haven't paid for.
   *
   * Crucially, the converted pence are deducted from `balanceCached` via an
   * `adjustment` ledger entry. Attendance skips the per-lesson charge whenever a
   * credit covers the lesson (postAutoCharge), so leaving the money on the
   * balance too would count it twice — once as a positive balance and again as
   * the free lessons the credits pay for — handing the family double the lessons
   * their money bought. The `adjustment` type keeps this reclassification out of
   * both the cash and accrual revenue reports (which key off `payment`/`charge`).
   *
   * Idempotent per source payment, so the fire-and-forget caller can re-run it
   * without double-issuing credits or double-deducting the balance.
   */
  async allocatePaymentToCredits(orgId: string, familyId: string, paymentId: string, amountPence: number) {
    const familyStudents = await this.db.db.query.students.findMany({
      where: and(eq(students.familyId, familyId), eq(students.organizationId, orgId)),
      with: {
        enrollments: {
          where: and(eq(enrollments.organizationId, orgId), eq(enrollments.status, 'active')),
          columns: { id: true, rate: true, lessonType: true },
        },
      },
    });

    // Only private lesson enrollments with a set rate are prepaid
    const billable = familyStudents.flatMap(s =>
      s.enrollments
        .filter(e => e.lessonType === 'private' && e.rate > 0)
        .map(e => ({ studentId: s.id, enrollmentId: e.id, rate: e.rate }))
    );

    if (billable.length === 0) return { allocated: 0, remainder: amountPence };

    return this.db.db.transaction(async (tx) => {
      // Re-running (the caller fires this off after commit) must be a no-op: if
      // this payment already minted credits, don't issue more or deduct again.
      const already = await tx.query.lessonCredits.findFirst({
        where: and(eq(lessonCredits.organizationId, orgId), eq(lessonCredits.sourcePaymentId, paymentId)),
        columns: { id: true },
      });
      if (already) return { allocated: 0, remainder: 0 };

      // Lock the family row so the balance we read (and the adjustment we post)
      // can't race a concurrent charge/payment.
      const [family] = await tx.select({ balanceCached: families.balanceCached }).from(families)
        .where(and(eq(families.id, familyId), eq(families.organizationId, orgId)))
        .for('update');
      if (!family) return { allocated: 0, remainder: amountPence };

      const pot = Math.max(0, family.balanceCached);
      const { credits, allocated } = planPrepaidCredits(billable, pot);
      if (allocated <= 0) return { allocated: 0, remainder: family.balanceCached };

      await tx.insert(lessonCredits).values(credits.map(c => ({
        organizationId: orgId,
        studentId: c.studentId,
        enrollmentId: c.enrollmentId,
        type: 'prepaid' as const,
        sourcePaymentId: paymentId,
        status: 'available' as const,
      })));

      const newBalance = family.balanceCached - allocated;
      await tx.insert(ledgerEntries).values({
        organizationId: orgId,
        familyId,
        type: 'adjustment',
        amount: -allocated,
        balanceAfter: newBalance,
        description: `Applied to ${credits.length} prepaid lesson credit${credits.length === 1 ? '' : 's'}`,
      });
      await tx.update(families)
        .set({ balanceCached: newBalance, updatedAt: new Date() })
        .where(eq(families.id, familyId));

      this.logger.log(
        `Payment ${paymentId}: converted ${allocated}p of on-account balance into ${credits.length} lesson credits (balance ${family.balanceCached}p → ${newBalance}p)`,
      );

      return { allocated, remainder: newBalance };
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────
  private async nextInvoiceNumber(orgId: string): Promise<string> {
    const count = await this.db.db.$count(invoices, eq(invoices.organizationId, orgId));
    return `INV-${String(count + 1).padStart(4, '0')}`;
  }
}
