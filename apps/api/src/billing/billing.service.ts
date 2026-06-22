import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import {
  invoices, invoiceLineItems, ledgerEntries, payments,
  families, students, enrollments, lessonCredits,
} from '@music-life/db';
import { DbService } from '../db/db.service';
import type { CreateInvoiceDto } from './dto/create-invoice.dto';
import type { RecordPaymentDto } from './dto/record-payment.dto';

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
        lineItems: true,
      },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    return inv;
  }

  async createInvoice(orgId: string, dto: CreateInvoiceDto) {
    const family = await this.db.db.query.families.findFirst({
      where: and(eq(families.id, dto.familyId), eq(families.organizationId, orgId)),
    });
    if (!family) throw new NotFoundException('Family not found');

    const number = await this.nextInvoiceNumber(orgId);
    const today = new Date().toISOString().split('T')[0]!;
    const due = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]!;

    const [inv] = await this.db.db.insert(invoices).values({
      ...dto,
      organizationId: orgId,
      number,
      issuedOn: today,
      dueDate: due,
      status: 'draft',
    }).returning();

    return inv!;
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

  // ─── Payments ──────────────────────────────────────────────────────────────
  async recordPayment(orgId: string, dto: RecordPaymentDto) {
    const family = await this.db.db.query.families.findFirst({
      where: and(eq(families.id, dto.familyId), eq(families.organizationId, orgId)),
    });
    if (!family) throw new NotFoundException('Family not found');

    const idempotencyKey = dto.providerRef
      ? `${dto.method}-${dto.providerRef}`
      : `pay-${dto.familyId}-${Date.now()}`;

    const [payment] = await this.db.db.insert(payments).values({
      ...dto,
      organizationId: orgId,
      idempotencyKey,
    }).returning();

    const newBalance = family.balanceCached + dto.amount;
    await this.db.db.insert(ledgerEntries).values({
      organizationId: orgId,
      familyId: dto.familyId,
      type: 'payment',
      amount: dto.amount,
      balanceAfter: newBalance,
      invoiceId: dto.invoiceId,
      description: `Payment via ${dto.method}${dto.providerRef ? ` (ref: ${dto.providerRef})` : ''}`,
    });

    await this.db.db.update(families)
      .set({ balanceCached: newBalance, updatedAt: new Date() })
      .where(eq(families.id, dto.familyId));

    if (dto.invoiceId) {
      const inv = await this.db.db.query.invoices.findFirst({ where: eq(invoices.id, dto.invoiceId) });
      if (inv && dto.amount >= inv.total && inv.status !== 'void') {
        await this.db.db.update(invoices)
          .set({ status: 'paid', updatedAt: new Date() })
          .where(eq(invoices.id, dto.invoiceId));
      }
    }

    // Payments not tied to a specific invoice are prepaid top-ups → auto-issue lesson credits
    if (!dto.invoiceId) {
      this.allocatePaymentToCredits(orgId, dto.familyId, payment!.id, dto.amount)
        .catch(err => this.logger.warn(`Credit allocation failed for payment ${payment!.id}: ${err}`));
    }

    return payment!;
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

  // Called by GoCardless/Revolut webhooks — idempotent via providerRef
  async recordProviderPayment(orgId: string, familyId: string, amountPence: number, method: 'gocardless' | 'revolut', providerRef: string) {
    const existing = await this.db.db.query.payments.findFirst({
      where: eq(payments.idempotencyKey, `${method}-${providerRef}`),
    });
    if (existing) return existing; // already processed

    return this.recordPayment(orgId, {
      familyId,
      method,
      amount: amountPence,
      providerRef,
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────
  private async nextInvoiceNumber(orgId: string): Promise<string> {
    const count = await this.db.db.$count(invoices, eq(invoices.organizationId, orgId));
    return `INV-${String(count + 1).padStart(4, '0')}`;
  }
}
