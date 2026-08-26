import {
  Controller, Post, Param, ParseUUIDPipe, BadRequestException, NotFoundException,
  Req, Headers, Logger,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { eq, and } from 'drizzle-orm';
import { invoices, revolutOrders } from '@music-life/db';
import { DbService } from '../db/db.service';
import { BillingService } from '../billing/billing.service';
import { RevolutService } from './revolut.service';

@Controller()
export class RevolutController {
  private readonly logger = new Logger(RevolutController.name);

  constructor(
    private readonly db: DbService,
    private readonly billing: BillingService,
    private readonly revolut: RevolutService,
  ) {}

  // Unauthenticated, like the rest of the public pay flow — the invoice's own
  // UUID is the only credential, same trust model as GET public/invoices/:id.
  // Throttled: this calls out to Revolut's API on every hit.
  @Post('public/invoices/:id/checkout')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async createCheckout(@Param('id', new ParseUUIDPipe()) id: string) {
    if (!this.revolut.isEnabled()) {
      throw new BadRequestException('Card payment is not available for this studio yet — please pay by bank transfer.');
    }
    const inv = await this.db.db.query.invoices.findFirst({ where: eq(invoices.id, id) });
    if (!inv || (inv.status !== 'sent') || inv.total <= 0) {
      throw new NotFoundException('Invoice not found');
    }

    const webUrl = (process.env.WEB_URL ?? 'http://localhost:3000').split(',')[0]!.trim();
    const { orderId, checkoutUrl } = await this.revolut.createOrder({
      amount: inv.total,
      currency: 'GBP',
      description: `Invoice ${inv.number}`,
      redirectUrl: `${webUrl}/pay/${inv.id}?revolut=1`,
      merchantOrderExtRef: inv.number,
    });

    await this.db.db.insert(revolutOrders).values({
      organizationId: inv.organizationId,
      invoiceId: inv.id,
      revolutOrderId: orderId,
      amount: inv.total,
      status: 'pending',
    });

    return { checkoutUrl };
  }

  // Revolut's own servers call this — no auth guard (there's nothing to
  // authenticate a webhook caller WITH other than the signature itself),
  // and no throttle (a burst of legitimate webhook deliveries shouldn't be
  // rate-limited the way a public browser-facing endpoint would be).
  @Post('webhooks/revolut')
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('revolut-signature') signature: string | undefined,
    @Headers('revolut-request-timestamp') timestamp: string | undefined,
  ) {
    const rawBody = req.rawBody?.toString('utf8') ?? '';
    if (!this.revolut.verifyWebhookSignature(rawBody, signature, timestamp)) {
      this.logger.warn('Rejected a Revolut webhook with an invalid/missing signature.');
      throw new BadRequestException('Invalid signature');
    }

    const event = JSON.parse(rawBody) as { event?: string; order_id?: string };
    const orderId = event.order_id;
    if (!orderId) return { ok: true };

    const order = await this.db.db.query.revolutOrders.findFirst({ where: eq(revolutOrders.revolutOrderId, orderId) });
    if (!order) {
      this.logger.warn(`Revolut webhook for unknown order ${orderId}`);
      return { ok: true };
    }
    // Already settled by an earlier delivery — Revolut retries webhooks, and
    // this must be a no-op the second time, not a second payment.
    if (order.status === 'completed') return { ok: true };

    // Never trust the webhook body's own state/amount — re-fetch the order
    // from Revolut directly and act on THAT.
    const canonical = await this.revolut.getOrder(orderId);
    if (canonical.state !== 'completed') return { ok: true };
    if (canonical.amount !== order.amount) {
      this.logger.error(`Revolut order ${orderId} amount mismatch: expected ${order.amount}, got ${canonical.amount}`);
      return { ok: true };
    }

    const inv = await this.db.db.query.invoices.findFirst({ where: and(eq(invoices.id, order.invoiceId)) });
    if (!inv) return { ok: true };

    const payment = await this.billing.recordPayment(inv.organizationId, {
      familyId: inv.familyId,
      invoiceId: inv.id,
      method: 'card',
      amount: order.amount,
      providerRef: orderId,
      notes: 'Paid by card via Revolut',
      idempotencyKey: `revolut-${orderId}`,
    });

    await this.db.db.update(revolutOrders)
      .set({ status: 'completed', paymentId: payment.id, updatedAt: new Date() })
      .where(eq(revolutOrders.id, order.id));

    return { ok: true };
  }
}
