import { Controller, Post, Get, Body, Param, ParseUUIDPipe, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MollieService } from './mollie.service';

// No guards — these are reached from the unauthenticated "pay online" link
// printed on invoice PDFs/emails, and from Mollie's servers.
@Controller('public/payments')
export class PublicPaymentsController {
  constructor(private readonly mollie: MollieService) {}

  /** Lets the pay page hide the card button entirely when no key is configured. */
  @Get('methods')
  methods() {
    return { card: this.mollie.isEnabled() };
  }

  /**
   * Start a card payment. Rate-limited: this is an unauthenticated endpoint
   * that creates a record at a third party, so it shouldn't be a free
   * request amplifier for anyone holding an invoice id.
   */
  @Post('mollie/checkout/:invoiceId')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  checkout(@Param('invoiceId', new ParseUUIDPipe()) invoiceId: string) {
    return this.mollie.createCheckout(invoiceId);
  }

  /**
   * Mollie's webhook. The body carries only `id`; the real status is re-read
   * from Mollie inside the service, so this can't be spoofed into marking an
   * invoice paid.
   *
   * Always answers 200 once handled. Mollie retries on non-2xx, which is what
   * we want for a genuine outage — but the service already treats non-paid
   * statuses and unknown invoices as no-ops, so those return cleanly rather
   * than driving a pointless retry loop.
   */
  @Post('mollie/webhook')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async webhook(@Body('id') id?: string) {
    if (!id) return { ok: true };
    await this.mollie.handleWebhook(id);
    return { ok: true };
  }
}
