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
  private readonly groupId: number;
  private readonly logger = new Logger(MailrelayAdapter.name);
  private readonly breaker = new CircuitBreaker({ name: 'mailrelay-email', failureThreshold: 3, timeout: 120_000 });

  constructor() {
    super();
    if (!process.env.MAILRELAY_API_URL) throw new Error('MAILRELAY_API_URL is required');
    if (!process.env.MAILRELAY_API_KEY) throw new Error('MAILRELAY_API_KEY is required');
    this.baseUrl = process.env.MAILRELAY_API_URL.replace(/\/$/, '');
    this.token = process.env.MAILRELAY_API_KEY;
    this.defaultFrom = process.env.EMAIL_FROM ?? 'Music & Life <no-reply@musiclife.studio>';
    // Subscriber group new contacts are added to (Mailrelay "Default" = 1).
    this.groupId = parseInt(process.env.MAILRELAY_GROUP_ID ?? '1', 10) || 1;
  }

  /**
   * Mailrelay only delivers to known subscribers, so before sending we make sure
   * every recipient is on the list. This runs on every send — so approving a
   * student (welcome email) or inviting a teacher (invite email) auto-subscribes
   * them, and so do resets/reminders. Best-effort and idempotent: an "already
   * taken" 422 means they're already subscribed (fine); any other failure is
   * logged but never blocks the actual send.
   */
  private async ensureSubscriber(raw: string): Promise<void> {
    const { email, name } = parseAddress(raw);
    try {
      const res = await fetch(`${this.baseUrl}/subscribers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': this.token },
        body: JSON.stringify({ email, name, status: 'active', group_ids: [this.groupId] }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        this.logger.log(`Subscriber ensured: ${email}`);
        return;
      }
      const body = await res.text().catch(() => '');
      if (res.status === 422 && /taken|already|exist/i.test(body)) return; // already a subscriber
      this.logger.warn(`Could not ensure subscriber ${email}: ${res.status} ${body}`);
    } catch (err) {
      this.logger.warn(`ensureSubscriber failed for ${email}: ${err}`);
    }
  }

  async send(opts: SendEmailOptions): Promise<void> {
    const toList = Array.isArray(opts.to) ? opts.to : [opts.to];
    // Add recipients to the subscriber list first (outside the send breaker, so
    // list-building keeps working even if sending is temporarily tripped).
    await Promise.all(toList.map((addr) => this.ensureSubscriber(addr)));

    // Only a 429/5xx means the provider itself is struggling and should count
    // toward the breaker. A rejected recipient (any other 4xx) is this
    // message's problem — counting those would let a few dead addresses in a
    // bulk run open the circuit and silently drop everyone still queued behind
    // them. Mirrors SenderAdapter.sendOne().
    type Outcome = { ok: true } | { ok: false; detail: string };

    const outcome = await this.breaker.call(async (): Promise<Outcome> => {
      // Without a timeout, a provider that accepts the connection but never
      // responds hangs this fetch (and the breaker.call() awaiting it)
      // forever — it never counts as a failure and never trips the breaker.
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
        signal: AbortSignal.timeout(20_000),
      });

      if (res.ok) return { ok: true };

      const body = await res.text().catch(() => '');
      if (res.status === 429 || res.status >= 500) {
        this.logger.error(`Failed to send email to ${opts.to}: ${res.status} ${body}`);
        throw new Error(`Email delivery failed: ${res.status} ${body}`);
      }
      return { ok: false, detail: `${res.status} ${body}` };
    });

    if (!outcome.ok) {
      this.logger.error(`Failed to send email to ${opts.to}: ${outcome.detail}`);
      throw new Error(`Email delivery failed: ${outcome.detail}`);
    }
    this.logger.log(`Email sent to ${opts.to}: "${opts.subject}"`);
  }
}
