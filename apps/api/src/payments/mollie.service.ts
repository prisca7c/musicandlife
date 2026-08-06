import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { invoices, organizations } from '@music-life/db';
import { DbService } from '../db/db.service';
import { BillingService } from '../billing/billing.service';
import { CircuitBreaker } from '../common/circuit-breaker/circuit-breaker';

/**
 * Mollie card payments for invoices.
 *
 * Security model — this is deliberately "fetch to verify", Mollie's documented
 * pattern: the webhook body carries only a payment id, never an amount or a
 * status. We ignore everything in the body except that id and re-read the
 * payment from Mollie's API using our own secret key. A forged webhook can
 * therefore only make us re-check a payment that genuinely exists; it can never
 * assert that something was paid. That's why no shared webhook secret is
 * needed for this flow.
 *
 * Money is only ever taken from the *invoice* record server-side — never from
 * anything the browser or the webhook sends — so a tampered request can't
 * change what a family is charged.
 */

const MOLLIE_API = 'https://api.mollie.com/v2';

interface MolliePayment {
  id: string;
  status: string;
  amount: { value: string; currency: string };
  metadata?: { invoiceId?: string } | null;
}

@Injectable()
export class MollieService {
  private readonly logger = new Logger(MollieService.name);
  private readonly breaker = new CircuitBreaker({ name: 'mollie', failureThreshold: 3, timeout: 60_000 });

  constructor(
    private readonly db: DbService,
    private readonly billing: BillingService,
  ) {}

  /** Card payments are only offered when a key is configured — otherwise the pay page just shows bank transfer. */
  isEnabled(): boolean {
    return !!process.env.MOLLIE_API_KEY;
  }

  private key(): string {
    const k = process.env.MOLLIE_API_KEY;
    if (!k) throw new BadRequestException('Card payments are not configured for this studio.');
    return k;
  }

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    return this.breaker.call(async () => {
      const res = await fetch(`${MOLLIE_API}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.key()}`,
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
        },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.error(`Mollie ${init?.method ?? 'GET'} ${path} failed: ${res.status} ${body}`);
        throw new Error(`Mollie request failed: ${res.status}`);
      }
      return res.json() as Promise<T>;
    });
  }

  /** Pence → Mollie's decimal string ("1250" → "12.50"). */
  private static toAmount(pence: number): string {
    return (pence / 100).toFixed(2);
  }

  /**
   * Start a card payment for an invoice and hand back Mollie's hosted checkout
   * URL. The amount is read from the invoice server-side; nothing the caller
   * sends can influence what's charged.
   */
  async createCheckout(invoiceId: string): Promise<{ checkoutUrl: string }> {
    const inv = await this.db.db.query.invoices.findFirst({
      where: eq(invoices.id, invoiceId),
      columns: { id: true, number: true, total: true, status: true, organizationId: true },
    });
    // Mirror the public summary's rules: only an issued, unpaid, positive
    // invoice can be paid. Drafts/voids aren't payable, a paid one must not be
    // chargeable twice, and a credit note is money owed *to* the family.
    if (!inv || inv.status !== 'sent') throw new NotFoundException('Invoice not found');
    if (inv.total <= 0) throw new BadRequestException('There is nothing to pay on this invoice.');

    const org = await this.db.db.query.organizations.findFirst({
      where: eq(organizations.id, inv.organizationId),
      columns: { name: true },
    });

    const payment = await this.call<MolliePayment & { _links: { checkout?: { href: string } } }>('/payments', {
      method: 'POST',
      body: JSON.stringify({
        amount: { currency: 'GBP', value: MollieService.toAmount(inv.total) },
        description: `${org?.name ?? 'Music & Life'} invoice ${inv.number}`,
        redirectUrl: `${process.env.WEB_URL}/pay/${inv.id}`,
        // NestJS URI versioning (main.ts) puts every route under /api/v1 —
        // this must match exactly what Mollie is told to call.
        webhookUrl: `${process.env.API_PUBLIC_URL}/api/v1/public/payments/mollie/webhook`,
        metadata: { invoiceId: inv.id },
      }),
    });

    const checkoutUrl = payment._links?.checkout?.href;
    if (!checkoutUrl) throw new Error('Mollie did not return a checkout URL');
    return { checkoutUrl };
  }

  /**
   * Handle a webhook. Takes only the payment id — the status and amount are
   * re-read from Mollie, never trusted from the request body.
   *
   * Mollie retries on any non-2xx, and fires for every status change (not just
   * success), so this must be safe to run repeatedly. It is: non-paid statuses
   * are a no-op, and recordPayment de-dupes on providerRef, so a replayed
   * "paid" webhook returns the original payment instead of charging again.
   */
  async handleWebhook(paymentId: string): Promise<void> {
    const payment = await this.call<MolliePayment>(`/payments/${encodeURIComponent(paymentId)}`);

    if (payment.status !== 'paid') {
      this.logger.log(`Mollie webhook ${paymentId}: status "${payment.status}" — nothing to record.`);
      return;
    }

    const invoiceId = payment.metadata?.invoiceId;
    if (!invoiceId) {
      this.logger.warn(`Mollie payment ${paymentId} is paid but carries no invoiceId metadata.`);
      return;
    }

    const inv = await this.db.db.query.invoices.findFirst({
      where: eq(invoices.id, invoiceId),
      columns: { id: true, familyId: true, organizationId: true },
    });
    if (!inv) {
      this.logger.warn(`Mollie payment ${paymentId} references unknown invoice ${invoiceId}.`);
      return;
    }

    // Trust Mollie's settled amount, not the invoice total — a partial or
    // altered amount must be recorded as what actually arrived.
    const amountPence = Math.round(parseFloat(payment.amount.value) * 100);

    await this.billing.recordPayment(inv.organizationId, {
      familyId: inv.familyId,
      invoiceId: inv.id,
      method: 'card',
      amount: amountPence,
      providerRef: payment.id,
      notes: 'Paid by card (Mollie)',
    });
    this.logger.log(`Mollie payment ${paymentId} recorded against invoice ${invoiceId}.`);
  }
}
