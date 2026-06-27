import { Injectable, Logger } from '@nestjs/common';
import { EmailPort, type SendEmailOptions } from '../ports/email.port';
import { CircuitBreaker } from '../../common/circuit-breaker/circuit-breaker';

function parseAddress(raw: string): { email: string; name?: string } {
  const match = raw.match(/^(.*?)\s*<(.+)>$/);
  return match ? { email: match[2].trim(), name: match[1].trim() || undefined } : { email: raw.trim() };
}

/**
 * Mailrelay REST API adapter. Base URL and token are account-specific — copy
 * both from the Mailrelay dashboard (Settings > API). Verified live against a
 * real account: POST {base}/send_emails, x-auth-token header, with `from` as
 * a {email,name} object and `to` as an array of {email} objects (NOT plain
 * strings — Mailrelay's validator 422s on flat strings with "is required").
 *
 * The sending domain in EMAIL_FROM must be added and DNS-verified (SPF/DKIM)
 * inside Mailrelay first, or every send 422s with a sender/SPF error — this
 * is an account/DNS setup step, not something fixable in code.
 */
@Injectable()
export class MailrelayAdapter extends EmailPort {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly defaultFrom: string;
  private readonly logger = new Logger(MailrelayAdapter.name);
  private readonly breaker = new CircuitBreaker({ name: 'mailrelay-email', failureThreshold: 3, timeout: 120_000 });

  constructor() {
    super();
    if (!process.env.MAILRELAY_API_URL) throw new Error('MAILRELAY_API_URL is required');
    if (!process.env.MAILRELAY_API_KEY) throw new Error('MAILRELAY_API_KEY is required');
    this.baseUrl = process.env.MAILRELAY_API_URL.replace(/\/$/, '');
    this.token = process.env.MAILRELAY_API_KEY;
    this.defaultFrom = process.env.EMAIL_FROM ?? 'Music & Life <no-reply@musiclife.studio>';
  }

  async send(opts: SendEmailOptions): Promise<void> {
    await this.breaker.call(async () => {
      const toList = Array.isArray(opts.to) ? opts.to : [opts.to];
      const res = await fetch(`${this.baseUrl}/send_emails`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': this.token,
        },
        body: JSON.stringify({
          from: parseAddress(opts.from ?? this.defaultFrom),
          to: toList.map(parseAddress),
          subject: opts.subject,
          html_part: opts.html,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.error(`Failed to send email to ${opts.to}: ${res.status} ${body}`);
        throw new Error(`Email delivery failed: ${res.status} ${body}`);
      }
      this.logger.log(`Email sent to ${opts.to}: "${opts.subject}"`);
    });
  }
}
