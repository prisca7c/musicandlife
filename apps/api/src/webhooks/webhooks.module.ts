import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { GoCardlessWebhookService } from './gocardless-webhook.service';
import { RevolutWebhookService } from './revolut-webhook.service';
import { BillingModule } from '../billing/billing.module';
import { FamiliesModule } from '../families/families.module';

@Module({
  imports: [BillingModule, FamiliesModule],
  controllers: [WebhooksController],
  providers: [GoCardlessWebhookService, RevolutWebhookService],
})
export class WebhooksModule {}
