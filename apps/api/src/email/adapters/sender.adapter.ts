import { Injectable, Logger } from '@nestjs/common';
import { EmailPort, type SendEmailOptions, type AddContactOptions, type ContactAudience } from '../ports/email.port';
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

    for (const addr of toList) {
      await this.sendOne(from, addr, opts);
    }
  }

  /**
   * Send to one address, distinguishing a bad *recipient* from a bad *service*.
   *
   * This matters for bulk sends. The breaker opens after 3 consecutive
   * failures, and a broadcast to a few hundred families is a near-certainty to
   * contain a handful of dead or mistyped addresses. If a rejected recipient
   * counted as a breaker failure, three bad addresses in a row would open the
   * circuit and every remaining family in that run would be dropped in
   * milliseconds — reported as "failed" with nothing actually wrong. So only a
   * 429 or 5xx (the provider genuinely struggling) counts toward the breaker;
   * any other 4xx is this message's problem and is raised without tripping it.
   */
  private async sendOne(
    from: { email: string; name?: string },
    addr: string,
    opts: SendEmailOptions,
  ): Promise<void> {
    type Outcome = { ok: true } | { ok: false; detail: string };

    const outcome = await this.breaker.call(async (): Promise<Outcome> => {
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

      if (res.ok) return { ok: true };

      const body = await res.text().catch(() => '');
      // The provider is failing, not this recipient — let it count.
      if (res.status === 429 || res.status >= 500) {
        this.logger.error(`Failed to send email to ${addr}: ${res.status} ${body}`);
        throw new Error(`Email delivery failed: ${res.status} ${body}`);
      }
      return { ok: false, detail: `${res.status} ${body}` };
    });

    if (!outcome.ok) {
      this.logger.error(`Failed to send email to ${addr}: ${outcome.detail}`);
      throw new Error(`Email delivery failed: ${outcome.detail}`);
    }
    this.logger.log(`Email sent to ${addr}: "${opts.subject}"`);
  }

  /** Map an audience to the configured Sender group id(s), if any. */
  private groupsFor(audience?: ContactAudience): string[] {
    const map: Record<ContactAudience, string | undefined> = {
      families: process.env.SENDER_GROUP_FAMILIES,
      teachers: process.env.SENDER_GROUP_TEACHERS,
      students: process.env.SENDER_GROUP_STUDENTS,
    };
    const id = audience ? map[audience] : undefined;
    return id ? [id] : [];
  }

  /**
   * Add/ensure a contact in Sender's list. Runs outside the send breaker and is
   * best-effort: an "already exists" response is treated as success, and any
   * other failure is logged but never thrown (the caller's main action must
   * still succeed). If SENDER_GROUP_* isn't configured the contact is added to
   * the account with no group.
   */
  async addContact(opts: AddContactOptions): Promise<void> {
    const groups = this.groupsFor(opts.audience);
    const parts = (opts.name ?? '').trim().split(/\s+/).filter(Boolean);
    const firstname = parts.shift();
    const lastname = parts.length ? parts.join(' ') : undefined;
    try {
      const res = await fetch(`${this.baseUrl}/subscribers`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          email: opts.email,
          ...(firstname ? { firstname } : {}),
          ...(lastname ? { lastname } : {}),
          ...(groups.length ? { groups } : {}),
        }),
      });
      if (res.ok) {
        this.logger.log(`Contact added to Sender: ${opts.email}${opts.audience ? ` (${opts.audience})` : ''}`);
        return;
      }
      const body = await res.text().catch(() => '');
      if (res.status === 409 || /already|exist|taken|duplicate/i.test(body)) return; // already a contact
      this.logger.warn(`Could not add contact ${opts.email}: ${res.status} ${body}`);
    } catch (err) {
      this.logger.warn(`addContact failed for ${opts.email}: ${err}`);
    }
  }
}
