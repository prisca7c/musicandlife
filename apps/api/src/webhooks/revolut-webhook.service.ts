import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { BillingService } from '../billing/billing.service';

// Revolut Business webhooks fire when a payment is received into your Revolut account.
// Set REVOLUT_WEBHOOK_SECRET in env once you sign up.
// Webhook URL to register in Revolut dashboard: POST /webhooks/revolut

@Injectable()
export class RevolutWebhookService {
  private readonly logger = new Logger(RevolutWebhookService.name);
  private readonly secret = process.env['REVOLUT_WEBHOOK_SECRET'] ?? '';

  constructor(private readonly billing: BillingService) {}

  verifySignature(rawBody: Buffer, signature: string): boolean {
    if (!this.secret) {
      this.logger.warn('REVOLUT_WEBHOOK_SECRET not set — skipping signature verification');
      return true;
    }
    // Revolut uses HMAC-SHA256 in the Revolut-Signature header
    const expected = crypto.createHmac('sha256', this.secret).update(rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  async handleEvent(event: RevolutWebhookEvent) {
    this.logger.log(`Revolut event: ${event.event} (${event.id})`);

    if (event.event === 'TransactionCreated' && event.data?.type === 'transfer') {
      const tx = event.data;
      const orgId = (tx['merchant'] as Record<string, unknown>)?.['name'] as string | undefined;
      const familyId = tx['reference'] as string | undefined;
      const amountPence = tx['amount'] as number | undefined;

      if (!orgId || !familyId || !amountPence) {
        this.logger.warn(`Revolut transaction ${event.id} missing org/family reference — needs manual matching`);
        return;
      }

      await this.billing.recordProviderPayment(orgId, familyId, amountPence, 'revolut', event.id);
    }
  }
}

interface RevolutWebhookEvent {
  id: string;
  event: string;
  data?: Record<string, unknown>;
}
