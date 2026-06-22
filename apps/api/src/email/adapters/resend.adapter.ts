import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { EmailPort, type SendEmailOptions } from '../ports/email.port';
import { CircuitBreaker } from '../../common/circuit-breaker/circuit-breaker';

@Injectable()
export class ResendAdapter extends EmailPort {
  private readonly client: Resend;
  private readonly defaultFrom: string;
  private readonly logger = new Logger(ResendAdapter.name);
  private readonly breaker = new CircuitBreaker({ name: 'resend-email', failureThreshold: 3, timeout: 120_000 });

  constructor() {
    super();
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is required');
    this.client = new Resend(process.env.RESEND_API_KEY);
    this.defaultFrom = process.env.EMAIL_FROM ?? 'Music & Life <onboarding@resend.dev>';
  }

  async send(opts: SendEmailOptions): Promise<void> {
    await this.breaker.call(async () => {
      const { error } = await this.client.emails.send({
        from: opts.from ?? this.defaultFrom,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
      });
      if (error) {
        this.logger.error(`Failed to send email to ${opts.to}: ${error.message}`);
        throw new Error(`Email delivery failed: ${error.message}`);
      }
      this.logger.log(`Email sent to ${opts.to}: "${opts.subject}"`);
    });
  }
}
