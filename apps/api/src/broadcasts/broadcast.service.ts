import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { memberships, users } from '@music-life/db';
import { DbService } from '../db/db.service';
import { EmailPort } from '../email/ports/email.port';
import { TEMPLATES } from '../notifications/notifications.service';
import type { BroadcastAudience } from './dto/broadcast.dto';

// The roles that make up each audience. "Families" means the parents/guardians
// who receive studio communications; children (students) are addressed on their
// own only when explicitly chosen.
const AUDIENCE_ROLES: Record<BroadcastAudience, string[]> = {
  families: ['guardian'],
  teachers: ['teacher'],
  students: ['student'],
  everyone: ['guardian', 'teacher', 'student'],
};

/**
 * Turn the plain text a staff member types into safe, paragraph-formatted HTML.
 * The newsletter template drops `body` straight into the branded shell, so we
 * escape first (no HTML injection from the compose box) and then honour blank
 * lines as paragraphs and single newlines as line breaks.
 */
export function broadcastBodyToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 12px">${para.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

@Injectable()
export class BroadcastService {
  private readonly logger = new Logger(BroadcastService.name);

  constructor(
    private readonly db: DbService,
    private readonly email: EmailPort,
  ) {}

  /** Distinct, lower-cased recipient addresses for an audience in this org. */
  private async audienceEmails(orgId: string, audience: BroadcastAudience): Promise<string[]> {
    const rows = await this.db.db.query.memberships.findMany({
      where: and(
        eq(memberships.organizationId, orgId),
        eq(memberships.status, 'active'),
        inArray(memberships.baseRole, AUDIENCE_ROLES[audience] as never),
      ),
      with: { user: { columns: { email: true } } },
    });
    const emails = rows
      .map((r) => r.user?.email?.trim().toLowerCase())
      .filter((e): e is string => !!e);
    return [...new Set(emails)];
  }

  /** How many people each audience would reach — powers the pre-send count. */
  async audienceCounts(orgId: string): Promise<Record<BroadcastAudience, number>> {
    const [families, teachers, students, everyone] = await Promise.all([
      this.audienceEmails(orgId, 'families'),
      this.audienceEmails(orgId, 'teachers'),
      this.audienceEmails(orgId, 'students'),
      this.audienceEmails(orgId, 'everyone'),
    ]);
    return {
      families: families.length,
      teachers: teachers.length,
      students: students.length,
      everyone: everyone.length,
    };
  }

  private render(subject: string, body: string) {
    return TEMPLATES['newsletter.event']!({
      orgId: '',
      subject,
      body: broadcastBodyToHtml(body),
    });
  }

  /** Send the composed email to a single address (the sender testing it on themselves). */
  async sendTest(orgId: string, userId: string, subject: string, body: string) {
    const me = await this.db.db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { email: true },
    });
    if (!me?.email) throw new NotFoundException('Your account has no email address to send a test to.');

    const { subject: subj, html } = this.render(subject, body);
    await this.email.send({ to: me.email, subject: subj, html });
    return { ok: true, sentTo: me.email };
  }

  /**
   * Fan the composed email out to a whole audience. Individual failures are
   * tolerated and counted rather than aborting the run, so one bad address
   * can't stop everyone else from being reached.
   */
  async send(orgId: string, audience: BroadcastAudience, subject: string, body: string) {
    const recipients = await this.audienceEmails(orgId, audience);
    const { subject: subj, html } = this.render(subject, body);

    let sent = 0;
    let failed = 0;
    for (const to of recipients) {
      try {
        await this.email.send({ to, subject: subj, html });
        sent++;
      } catch (err) {
        failed++;
        this.logger.warn(`Broadcast to ${to} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    this.logger.log(`Broadcast "${subject}" to ${audience}: ${sent} sent, ${failed} failed of ${recipients.length}`);
    return { audience, total: recipients.length, sent, failed };
  }
}
