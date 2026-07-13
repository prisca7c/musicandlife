import { Injectable, Logger } from '@nestjs/common';
import { EmailPort, type SendEmailOptions } from '../ports/email.port';
import { CircuitBreaker } from '../../common/circuit-breaker/circuit-breaker';

function parseAddress(raw: string): { email: string; name?: string } {
  const match = raw.match(/^(.*?)\s*<(.+)>$/);
  return match ? { email: match[2].trim(), name: match[1].trim() || undefined } : { email: raw.trim() };
}

/**
 * Sender.net transactional email adapter.
 * Docs: https://api.sender.net — POST {base}/message/send, Bearer token,
 * body { from:{email,name}, to:{email,name}, subject, html }.
 *
 * Unlike Mailrelay, the transactional endpoint delivers to ANY recipient, so
 * there's no subscriber-list step. The FROM address must be on a domain that
 * is verified (SPF + DKIM) in the Sender dashboard, or the API rejects the
 * send with a 400 "SPF/DKIM records are not configured" — that's a DNS setup
 * step, not something fixable in code.
 *
 * Sender's `to` field is a single object, so when there are multiple
 * recipients we send one message each.
 */
@Injectable()
export class SenderAdapter extends EmailPort {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly defaultFrom: string;
  private readonly logger = new Logger(SenderAdapter.name);
  private readonly breaker = new CircuitBreaker({ name: 'sender-email', failureThreshold: 3, timeout: 120_000 });

  constructor() {
    super();
    if (!process.env.SENDER_API_KEY) throw new Error('SENDER_API_KEY is required');
    this.baseUrl = (process.env.SENDER_API_URL ?? 'https://api.sender.net/v2').replace(/\/$/, '');
    this.token = process.env.SENDER_API_KEY;
    this.defaultFrom = process.env.EMAIL_FROM ?? 'Music & Life <no-reply@musiclife.studio>';
  }

  async send(opts: SendEmailOptions): Promise<void> {
    const toList = Array.isArray(opts.to) ? opts.to : [opts.to];
    const from = parseAddress(opts.from ?? this.defaultFrom);

    await this.breaker.call(async () => {
      for (const addr of toList) {
        const res = await fetch(`${this.baseUrl}/message/send`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.token}`,
          },
          body: JSON.stringify({
            from,
            to: parseAddress(addr),
            subject: opts.subject,
            html: opts.html,
          }),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          this.logger.error(`Failed to send email to ${addr}: ${res.status} ${body}`);
          throw new Error(`Email delivery failed: ${res.status} ${body}`);
        }
        this.logger.log(`Email sent to ${addr}: "${opts.subject}"`);
      }
    });
  }
}
