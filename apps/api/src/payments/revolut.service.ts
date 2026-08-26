import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Revolut Merchant API client — card payments alongside bank transfer.
 *
 * Feature-flagged off by default: every method that talks to Revolut checks
 * isEnabled() first, and callers (the public checkout endpoint, the public
 * invoice summary's `cardPaymentEnabled` flag) gate on it too, so the whole
 * flow is inert until REVOLUT_API_KEY is actually set. No API keys are
 * hard-coded anywhere — they're read from env at request time.
 *
 * IMPORTANT: the exact request/response field names below (checkout_url,
 * capture_mode, the Revolut-Signature header format, etc.) are built from
 * Revolut's documented Merchant API shape, but this has never been run
 * against a real sandbox response — there's no account to test against yet.
 * Once real sandbox credentials exist, the first live createOrder()/webhook
 * round-trip should be checked against Revolut's current API reference and
 * this file adjusted if anything's drifted. Everything Revolut-specific is
 * deliberately kept in this one file so that adjustment stays localised.
 */
@Injectable()
export class RevolutService {
  private readonly logger = new Logger(RevolutService.name);

  isEnabled(): boolean {
    return !!process.env.REVOLUT_API_KEY;
  }

  private apiBase(): string {
    // Defaults to sandbox — production requires explicitly setting the live
    // API base, so a missing/misconfigured env var can never accidentally
    // start moving real money.
    return process.env.REVOLUT_API_BASE_URL ?? 'https://sandbox-merchant.revolut.com';
  }

  private apiKey(): string {
    const key = process.env.REVOLUT_API_KEY;
    if (!key) throw new BadRequestException('Card payment is not configured for this studio.');
    return key;
  }

  /**
   * Create a hosted-checkout order. `amount` is pence (minor units) — same
   * as every other amount in this app, and Revolut's Orders API also takes
   * amount in minor units, so no conversion is needed here.
   */
  async createOrder(opts: {
    amount: number; currency: string; description: string; redirectUrl: string; merchantOrderExtRef: string;
  }): Promise<{ orderId: string; checkoutUrl: string }> {
    const res = await fetch(`${this.apiBase()}/api/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey()}`,
        'Content-Type': 'application/json',
        'Revolut-Api-Version': '2024-09-01',
      },
      body: JSON.stringify({
        amount: opts.amount,
        currency: opts.currency,
        description: opts.description,
        capture_mode: 'AUTOMATIC',
        redirect_url: opts.redirectUrl,
        merchant_order_ext_ref: opts.merchantOrderExtRef,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.error(`Revolut createOrder failed (${res.status}): ${body}`);
      throw new BadRequestException('Could not start the card payment. Please try bank transfer instead, or try again shortly.');
    }
    const data = (await res.json()) as { id: string; checkout_url?: string; token?: string };
    // Revolut's Orders API has returned either a direct checkout_url or a
    // short-lived `token` used to build the hosted-payment-page URL,
    // depending on API version — handle both until confirmed against a real
    // sandbox response.
    const checkoutUrl = data.checkout_url ?? (data.token ? `https://checkout.revolut.com/payment-link/${data.token}` : '');
    if (!checkoutUrl) {
      this.logger.error(`Revolut createOrder response had no checkout_url/token: ${JSON.stringify(data)}`);
      throw new BadRequestException('Could not start the card payment. Please try bank transfer instead, or try again shortly.');
    }
    return { orderId: data.id, checkoutUrl };
  }

  /**
   * Re-fetch an order's canonical state from Revolut directly — the webhook
   * handler uses this rather than trusting the webhook body's own amount/
   * state, so a forged or replayed webhook payload can't mark an invoice
   * paid on its say-so alone.
   */
  async getOrder(orderId: string): Promise<{ id: string; state: string; amount: number; currency: string }> {
    const res = await fetch(`${this.apiBase()}/api/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${this.apiKey()}`, 'Revolut-Api-Version': '2024-09-01' },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BadRequestException(`Could not verify the order with Revolut (${res.status}): ${body}`);
    }
    return (await res.json()) as { id: string; state: string; amount: number; currency: string };
  }

  /**
   * Revolut signs each webhook delivery as HMAC-SHA256 of
   * `v1.{timestamp}.{rawBody}` using the webhook signing secret, sent as
   * `v1=<hex>` in the Revolut-Signature header alongside a
   * Revolut-Request-Timestamp header. Verified with a constant-time compare
   * so timing can't leak the correct signature byte by byte.
   */
  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined, timestampHeader: string | undefined): boolean {
    const secret = process.env.REVOLUT_WEBHOOK_SECRET;
    if (!secret || !signatureHeader || !timestampHeader) return false;

    const provided = signatureHeader.split(',').find((p) => p.startsWith('v1='))?.slice(3);
    if (!provided) return false;

    const expected = createHmac('sha256', secret)
      .update(`v1.${timestampHeader}.${rawBody}`)
      .digest('hex');

    const a = Buffer.from(provided, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
