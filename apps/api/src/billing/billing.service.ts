import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import {
  invoices, invoiceLineItems, ledgerEntries, payments,
  families, students, enrollments, lessonCredits, lessons, organizations,
} from '@music-life/db';
import { DbService } from '../db/db.service';
import type { CreateInvoiceDto } from './dto/create-invoice.dto';
import type { RecordPaymentDto } from './dto/record-payment.dto';

// A lesson billed at a different length than the student's normal duration is charged
// proportionally — e.g. a 30-min lesson on a 60-min/£rate enrollment charges half the rate.
export function proratedAmount(rate: number | undefined, defaultDuration: number | undefined, actualDuration: number): number {
  if (!rate) return 0;
  if (!defaultDuration || defaultDuration === actualDuration) return rate;
  return Math.round((rate * actualDuration) / defaultDuration);
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(private readonly db: DbService) {}

  // ─── Invoices ──────────────────────────────────────────────────────────────
  async getInvoices(orgId: string, familyId?: string) {
    return this.db.db.query.invoices.findMany({
      where: familyId
        ? and(eq(invoices.organizationId, orgId), eq(invoices.familyId, familyId))
        : eq(invoices.organizationId, orgId),
      with: { family: { columns: { id: true, name: true } } },
      orderBy: (i, { desc }) => [desc(i.issuedOn)],
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
      columns: { id: true, number: true, total: true, status: true, dueDate: true, organizationId: true },
    });
    // Only issued invoices are reachable via the public pay link. Drafts are
    // staff-only and not yet finalised; voids are cancelled — neither should be
    // resolvable (with the studio's bank details) by anyone holding the id.
    if (!inv || (inv.status !== 'sent' && inv.status !== 'paid')) {
      throw new NotFoundException('Invoice not found');
    }

    const org = await this.db.db.query.organizations.findFirst({
      where: eq(organizations.id, inv.organizationId),
    });
    const settings = (org?.settings as Record<string, unknown>) ?? {};

    return {
      number: inv.number,
      total: inv.total,
      status: inv.status,
      dueDate: inv.dueDate,
      org: {
        name: org?.name ?? 'Music & Life',
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
    }

    return inv!;
  }

  // Itemizes one line item per individual lesson occurrence (date, teacher, instrument
  // are read off the linked lesson at display time) for every student in the family,
  // sorted earliest-first, skipping lessons already billed on another invoice.
  private async generateLessonLineItems(
    orgId: string, invoiceId: string, familyId: string, periodStart?: string, periodEnd?: string,
  ) {
    const famStudents = await this.db.db.query.students.findMany({
      where: and(eq(students.organizationId, orgId), eq(students.familyId, familyId)),
      columns: { id: true },
    });
    const studentIds = famStudents.map(s => s.id);
    if (studentIds.length === 0) return;

    const candidateLessons = await this.db.db.query.lessons.findMany({
      where: and(
        eq(lessons.organizationId, orgId),
        inArray(lessons.studentId, studentIds),
        eq(lessons.status, 'completed'),
      ),
      with: {
        teacher: { columns: { firstName: true, lastName: true } },
        enrollment: { columns: { instrument: true, rate: true, defaultDuration: true, lessonType: true } },
      },
    });
    // No completed lessons → nothing to itemise. Returning here also avoids
    // calling inArray() with an empty list below, which builds invalid SQL and
    // 500s the whole invoice create (the "clicked invoice, not working" report).
    if (candidateLessons.length === 0) return;

    const alreadyBilled = await this.db.db.query.invoiceLineItems.findMany({
      where: and(
        eq(invoiceLineItems.organizationId, orgId),
        inArray(invoiceLineItems.lessonId, candidateLessons.map(l => l.id)),
      ),
      columns: { lessonId: true },
    });
    const billedLessonIds = new Set(alreadyBilled.map(i => i.lessonId));

    const start = periodStart ? new Date(periodStart) : null;
    const end = periodEnd ? new Date(`${periodEnd}T23:59:59`) : null;

    const eligible = candidateLessons
      .filter(l => !billedLessonIds.has(l.id))
      .filter(l => !start || l.startsAt >= start)
      .filter(l => !end || l.startsAt <= end)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

    if (eligible.length === 0) return;

    const rows = eligible.map(l => {
      const instrument = l.enrollment?.instrument
        ? l.enrollment.instrument.charAt(0).toUpperCase() + l.enrollment.instrument.slice(1)
        : '';
      const kind = l.enrollment?.lessonType === 'group' ? 'group class' : 'lesson';
      const description = [instrument, `${kind} · ${l.duration} min`].filter(Boolean).join(' ');
      return {
        organizationId: orgId,
        invoiceId,
        lessonId: l.id,
        description,
        amount: proratedAmount(l.enrollment?.rate, l.enrollment?.defaultDuration, l.duration),
      };
    });
    await this.db.db.insert(invoiceLineItems).values(rows);

    const total = rows.reduce((s, r) => s + r.amount, 0);
    await this.db.db.update(invoices).set({ total, updatedAt: new Date() }).where(eq(invoices.id, invoiceId));
  }

  async sendInvoice(orgId: string, id: string) {
    await this.getInvoice(orgId, id);
    const [updated] = await this.db.db.update(invoices)
      .set({ status: 'sent', updatedAt: new Date() })
      .where(and(eq(invoices.id, id), eq(invoices.organizationId, orgId)))
      .returning();
    return updated!;
  }

  async voidInvoice(orgId: string, id: string) {
    const inv = await this.getInvoice(orgId, id);
    if (inv.status === 'paid') throw new BadRequestException('Cannot void a paid invoice');
    const [updated] = await this.db.db.update(invoices)
      .set({ status: 'void', updatedAt: new Date() })
      .where(eq(invoices.id, id))
      .returning();
    return updated!;
  }

  async addLineItem(orgId: string, invoiceId: string, description: string, amount: number, lessonId?: string) {
    await this.getInvoice(orgId, invoiceId);
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

    return item!;
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

        // Guard against duplicate payments on an already-settled invoice. Because
        // the family row is locked above, concurrent full payments serialise here:
        // the first commits + marks the invoice paid, and every later one re-reads
        // it as 'paid' and returns the winner's payment instead of inserting again.
        // This closes the double-charge race for callers that don't send an
        // idempotency key, and turns concurrent self-pay double-taps into a clean
        // idempotent response rather than a unique-constraint 500. Partial payments
        // (invoice still 'sent') are unaffected and still accumulate normally.
        if (dto.invoiceId) {
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
          if (inv && dto.amount >= inv.total && inv.status !== 'void') {
            await tx.update(invoices)
              .set({ status: 'paid', updatedAt: new Date() })
              .where(eq(invoices.id, dto.invoiceId));
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

    return payment;
  }

  // Postgres unique-violation SQLSTATE is 23505 (surfaced by postgres-js on err.code).
  private isUniqueViolation(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
  }

  // ─── Credit allocation ────────────────────────────────────────────────────
  // When a prepaid payment arrives, split it across the family's active students
  // proportionally by lesson rate, converting whole lesson amounts to credits.
  // Any fractional remainder stays on the family ledger balance.
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

    const totalRate = billable.reduce((sum, b) => sum + b.rate, 0);
    let allocated = 0;
    const toInsert: Array<{
      organizationId: string; studentId: string; enrollmentId: string;
      type: 'prepaid'; sourcePaymentId: string; status: 'available';
    }> = [];

    for (const { studentId, enrollmentId, rate } of billable) {
      const share = (rate / totalRate) * amountPence;
      const creditCount = Math.floor(share / rate);
      if (creditCount <= 0) continue;

      for (let i = 0; i < creditCount; i++) {
        toInsert.push({
          organizationId: orgId,
          studentId,
          enrollmentId,
          type: 'prepaid',
          sourcePaymentId: paymentId,
          status: 'available',
        });
      }
      allocated += creditCount * rate;
    }

    if (toInsert.length > 0) {
      await this.db.db.insert(lessonCredits).values(toInsert);
    }

    this.logger.log(
      `Payment ${paymentId}: allocated ${allocated}p across ${toInsert.length} lesson credits, remainder ${amountPence - allocated}p on family balance`,
    );

    return { allocated, remainder: amountPence - allocated };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────
  private async nextInvoiceNumber(orgId: string): Promise<string> {
    const count = await this.db.db.$count(invoices, eq(invoices.organizationId, orgId));
    return `INV-${String(count + 1).padStart(4, '0')}`;
  }
}
