import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { BillingService } from '../billing/billing.service';

// Maps GoCardless mandate metadata.organization_id to the org in our DB.
// When you connect GoCardless, store the orgId in the mandate/customer metadata
// under the key "organization_id" and "family_id".

@Injectable()
export class GoCardlessWebhookService {
  private readonly logger = new Logger(GoCardlessWebhookService.name);
  private readonly secret = process.env['GOCARDLESS_WEBHOOK_SECRET'] ?? '';

  constructor(private readonly billing: BillingService) {}

  verifySignature(rawBody: Buffer, signature: string): boolean {
    if (!this.secret) {
      this.logger.warn('GOCARDLESS_WEBHOOK_SECRET not set — skipping signature verification');
      return true; // allow in dev; tighten before go-live
    }
    const expected = crypto.createHmac('sha256', this.secret).update(rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  async handleEvents(events: GoCardlessEvent[]) {
    for (const event of events) {
      try {
        await this.handleEvent(event);
      } catch (err) {
        this.logger.error(`Failed to process GoCardless event ${event.id}: ${err}`);
      }
    }
  }

  private async handleEvent(event: GoCardlessEvent) {
    this.logger.log(`GoCardless event: ${event.resource_type}.${event.action} (${event.id})`);

    if (event.resource_type === 'payments' && event.action === 'paid_out') {
      // Payment has cleared into our Starling account
      const meta = event.links?.payment_metadata as Record<string, string> | undefined;
      const orgId = meta?.['organization_id'];
      const familyId = meta?.['family_id'];
      const amountPence = event.details?.amount as number | undefined;

      if (!orgId || !familyId || !amountPence) {
        this.logger.warn(`GoCardless paid_out event ${event.id} missing metadata — needs manual review`);
        return;
      }

      await this.billing.recordProviderPayment(orgId, familyId, amountPence, 'gocardless', event.id);
    }

    if (event.resource_type === 'payments' && event.action === 'failed') {
      this.logger.warn(`GoCardless payment failed: ${event.id}. Needs manual follow-up.`);
      // TODO: send notification to admin when notification module supports it
    }
  }
}

interface GoCardlessEvent {
  id: string;
  resource_type: string;
  action: string;
  links?: Record<string, unknown>;
  details?: Record<string, unknown>;
}
