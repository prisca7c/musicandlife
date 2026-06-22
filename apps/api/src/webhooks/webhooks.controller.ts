import {
  Controller, Post, Headers, Req, RawBodyRequest,
  HttpCode, BadRequestException, Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { GoCardlessWebhookService } from './gocardless-webhook.service';
import { RevolutWebhookService } from './revolut-webhook.service';

// These endpoints are PUBLIC (no JWT guard) — they're called by GoCardless/Revolut servers.
// Security is provided by HMAC signature verification inside each service.

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly gocardless: GoCardlessWebhookService,
    private readonly revolut: RevolutWebhookService,
  ) {}

  @Post('gocardless')
  @HttpCode(200)
  async goCardless(
    @Headers('webhook-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) throw new BadRequestException('Missing raw body');

    if (!this.gocardless.verifySignature(rawBody, signature)) {
      this.logger.warn('GoCardless webhook signature mismatch — rejected');
      throw new BadRequestException('Invalid signature');
    }

    const body = JSON.parse(rawBody.toString()) as { events?: unknown[] };
    await this.gocardless.handleEvents((body.events ?? []) as Parameters<typeof this.gocardless.handleEvents>[0]);
    return { received: true };
  }

  @Post('revolut')
  @HttpCode(200)
  async revolvutWebhook(
    @Headers('revolut-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) throw new BadRequestException('Missing raw body');

    if (!this.revolut.verifySignature(rawBody, signature)) {
      this.logger.warn('Revolut webhook signature mismatch — rejected');
      throw new BadRequestException('Invalid signature');
    }

    const event = JSON.parse(rawBody.toString());
    await this.revolut.handleEvent(event);
    return { received: true };
  }
}
