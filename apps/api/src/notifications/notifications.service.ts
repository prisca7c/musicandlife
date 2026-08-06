import { Injectable, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { createHash } from 'crypto';
import { notificationRules, notificationLog, organizations, emailTemplates } from '@music-life/db';
import { DbService } from '../db/db.service';
import { EmailPort } from '../email/ports/email.port';
import { brandedEmail, loginDetailsBlock, BRAND } from '../email/branding';

// ctx.subject is free text a staff member typed (broadcast compose box);
// it's used verbatim as the literal email Subject header (safe — mail
// clients don't render HTML there) but also dropped into the HTML heading
// below, which does render raw markup. Escape only for the latter.
const escapeHtml = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));

export type TriggerEvent =
  | 'registration.received'
  | 'registration.submitted'
  | 'registration.approved'
  | 'registration.denied'
  | 'lesson.reminder_24h'
  | 'lesson.cancelled'
  | 'lesson.rescheduled'
  | 'booking.review_reminder'
  | 'invoice.sent'
  | 'invoice.preview_summary'
  | 'newsletter.event'
  | 'message.received'
  | 'payroll.approved';

export interface TriggerContext {
  orgId: string;
  userId?: string;
  email?: string;
  phone?: string;
  subject?: string;
  body: string;
  data?: Record<string, unknown>;
}

// Built-in templates keyed by templateId. Each returns a subject plus fully
// branded HTML (see email/branding.ts). `ctx.body` carries the event-specific
// detail line(s); `ctx.email` is the recipient.
export const TEMPLATES: Record<string, (ctx: TriggerContext) => { subject: string; html: string }> = {
  'registration.received.admin': (ctx) => ({
    subject: 'New registration received',
    html: brandedEmail({
      previewText: 'A new student registration is pending review.',
      heading: 'New registration received',
      bodyHtml: `<p style="margin:0 0 12px">A new student registration has been submitted and is pending your review.</p><p style="margin:0">${ctx.body}</p>`,
      cta: { label: 'Review in the admin portal', url: BRAND.portalUrl },
    }),
  }),
  'registration.submitted.family': (ctx) => ({
    subject: 'We received your registration - Music & Life',
    html: brandedEmail({
      previewText: "Thanks for registering - we'll be in touch as soon as we can.",
      heading: 'Thanks for registering!',
      bodyHtml:
        `<p style="margin:0 0 12px">Thank you for registering with Music &amp; Life - we're delighted to have you.</p>` +
        `<p style="margin:0 0 12px">${ctx.body}</p>` +
        `<p style="margin:0 0 12px">Our team will review your registration <strong>as soon as we can</strong>. Once it's approved you'll receive a welcome email with your portal login details.</p>` +
        `<p style="margin:0">If that welcome email doesn't arrive, please check your spam or junk folder - and marking it as "not spam" helps our messages reach you from then on.</p>`,
      footnote: 'Have a question in the meantime? Just reply to this email.',
    }),
  }),
  'registration.approved.family': (ctx) => ({
    subject: 'Welcome to Music & Life!',
    html: brandedEmail({
      previewText: 'Your registration is approved - here are your portal login details.',
      heading: 'Welcome to Music & Life!',
      bodyHtml:
        `<p style="margin:0 0 12px">Great news - your registration has been approved and your portal is ready.</p>` +
        (ctx.body ? `<p style="margin:0 0 4px">${ctx.body}</p>` : '') +
        loginDetailsBlock(ctx.email ?? 'the email you registered with') +
        `<p style="margin:14px 0 0">Sign in to book lessons, view your schedule, and manage billing. If it's your first time, use "Forgot password" to set a password.</p>`,
      cta: { label: 'Log in to your portal', url: BRAND.portalUrl },
      footnote: 'Keep this email for your records. Need help? Just reply.',
    }),
  }),
  'registration.denied.family': (ctx) => ({
    subject: 'Registration update',
    html: brandedEmail({
      previewText: 'An update on your Music & Life registration.',
      heading: 'Registration update',
      bodyHtml: `<p style="margin:0 0 12px">Thank you for your interest in Music &amp; Life. Unfortunately we're unable to approve your registration at this time.</p><p style="margin:0">${ctx.body}</p>`,
      footnote: "If you think this was a mistake, reply and we'll take another look.",
    }),
  }),
  'lesson.reminder_24h': (ctx) => ({
    subject: 'Lesson reminder - tomorrow',
    html: brandedEmail({
      previewText: 'A friendly reminder about your lesson tomorrow.',
      heading: 'See you tomorrow &#127925;',
      bodyHtml: `<p style="margin:0 0 12px">This is a friendly reminder that you have a lesson <strong>tomorrow</strong>.</p><p style="margin:0">${ctx.body}</p>`,
      cta: { label: 'View your schedule', url: BRAND.portalUrl },
      footnote: "Can't make it? Please let us know as soon as possible so we can offer the slot to someone else.",
    }),
  }),
  'lesson.cancelled': (ctx) => ({
    subject: 'Lesson cancelled',
    html: brandedEmail({
      previewText: 'One of your lessons has been cancelled.',
      heading: 'Lesson cancelled',
      bodyHtml: `<p style="margin:0 0 12px">A lesson has been cancelled.</p><p style="margin:0">${ctx.body}</p>`,
      cta: { label: 'View your schedule', url: BRAND.portalUrl },
    }),
  }),
  'lesson.rescheduled': (ctx) => ({
    subject: 'Your lesson has been rescheduled',
    html: brandedEmail({
      previewText: 'Your lesson has a new time.',
      heading: 'Your lesson has been rescheduled',
      bodyHtml: `<p style="margin:0 0 12px">A lesson has been moved to a new time.</p><p style="margin:0">${ctx.body}</p>`,
      cta: { label: 'View your schedule', url: BRAND.portalUrl },
      footnote: "If this new time doesn't work for you, get in touch and we'll sort it out.",
    }),
  }),
  // A family self-booked and their 1st choice is already on the teacher's
  // calendar — this nudges the teacher to confirm it or move it to one of the
  // family's back-up times if it doesn't work. The lesson stands eitherway; this
  // is only a prompt to review, sent once if it's still unreviewed after a day.
  'booking.review_reminder': (ctx) => ({
    subject: 'A new booking is waiting for your OK',
    html: brandedEmail({
      previewText: 'A family booked a lesson — please confirm or suggest another time.',
      heading: 'A booking needs your review',
      bodyHtml: `<p style="margin:0 0 12px">A family booked a lesson with you and it's on your calendar now.</p><p style="margin:0">${ctx.body}</p>`,
      cta: { label: 'Review in your portal', url: BRAND.portalUrl },
      footnote: 'If the time works, just confirm it. If not, you can move it to one of the family’s other choices or decline.',
    }),
  }),
  // Portal messages exist so teachers and families can talk without swapping
  // phone numbers. That only works if a message is actually noticed, so the
  // text comes through by email while replying stays in the portal.
  'message.received': (ctx) => ({
    subject: ctx.subject ?? 'New message from Music & Life',
    html: brandedEmail({
      previewText: 'You have a new message in your portal.',
      heading: 'You have a new message',
      bodyHtml:
        `<p style="margin:0 0 12px">${ctx.body}</p>` +
        `<p style="margin:0;color:#6b6b6b;font-size:13px">Reply in your portal — replying to this email won't reach the sender.</p>`,
      cta: { label: 'Read & reply in your portal', url: BRAND.portalUrl },
    }),
  }),
  'invoice.sent': (ctx) => ({
    subject: ctx.subject ?? 'New invoice from Music & Life',
    html: brandedEmail({
      previewText: 'A new invoice has been issued to your account.',
      heading: 'New invoice',
      bodyHtml: `<p style="margin:0 0 12px">An invoice has been issued to your account.</p><p style="margin:0">${ctx.body}</p>`,
      cta: { label: 'View & pay in your portal', url: BRAND.portalUrl },
    }),
  }),
  'invoice.preview_summary': (ctx) => ({
    subject: ctx.subject ?? 'Upcoming auto-invoices',
    html: brandedEmail({
      previewText: 'A summary of auto-invoices scheduled to go out soon.',
      heading: 'Upcoming auto-invoices',
      bodyHtml: `<p style="margin:0 0 12px">The following auto-invoices are scheduled to go out soon.</p><p style="margin:0">${ctx.body}</p>`,
    }),
  }),
  'newsletter.event': (ctx) => ({
    subject: ctx.subject ?? "What's on at Music & Life",
    html: brandedEmail({
      previewText: 'News and upcoming events from Music & Life.',
      heading: ctx.subject ? escapeHtml(ctx.subject) : "What's on at Music & Life",
      bodyHtml: ctx.body,
      cta: { label: 'Visit our website', url: BRAND.website },
      footnote: "You're receiving this because you're part of the Music & Life community.",
    }),
  }),
};

// Default rules seeded for every new org
export const DEFAULT_RULES: Array<{
  triggerEvent: TriggerEvent;
  templateId: string;
  channels: string[];
}> = [
  { triggerEvent: 'registration.received', templateId: 'registration.received.admin', channels: ['email'] },
  { triggerEvent: 'registration.submitted', templateId: 'registration.submitted.family', channels: ['email'] },
  { triggerEvent: 'registration.approved', templateId: 'registration.approved.family', channels: ['email'] },
  { triggerEvent: 'registration.denied', templateId: 'registration.denied.family', channels: ['email'] },
  { triggerEvent: 'lesson.reminder_24h', templateId: 'lesson.reminder_24h', channels: ['email'] },
  { triggerEvent: 'lesson.cancelled', templateId: 'lesson.cancelled', channels: ['email'] },
  { triggerEvent: 'lesson.rescheduled', templateId: 'lesson.rescheduled', channels: ['email'] },
  { triggerEvent: 'booking.review_reminder', templateId: 'booking.review_reminder', channels: ['email'] },
  { triggerEvent: 'invoice.sent', templateId: 'invoice.sent', channels: ['email'] },
  { triggerEvent: 'invoice.preview_summary', templateId: 'invoice.preview_summary', channels: ['email'] },
  { triggerEvent: 'newsletter.event', templateId: 'newsletter.event', channels: ['email'] },
  { triggerEvent: 'message.received', templateId: 'message.received', channels: ['email'] },
];

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly db: DbService,
    private readonly email: EmailPort,
  ) {}

  /** Seed default notification rules for an org (idempotent) */
  async seedDefaultRules(orgId: string) {
    for (const rule of DEFAULT_RULES) {
      const existing = await this.db.db.query.notificationRules.findFirst({
        where: and(
          eq(notificationRules.organizationId, orgId),
          eq(notificationRules.triggerEvent, rule.triggerEvent),
        ),
      });
      if (!existing) {
        await this.db.db.insert(notificationRules).values({ ...rule, organizationId: orgId });
      }
    }
  }

  /** Trigger an event — auto-seeds default rules for the org on first call, then delivers */
  async trigger(event: TriggerEvent, ctx: TriggerContext) {
    // Lazy-seed default rules so they exist from the first event
    await this.seedDefaultRules(ctx.orgId).catch(() => {});

    const rules = await this.db.db.query.notificationRules.findMany({
      where: and(
        eq(notificationRules.organizationId, ctx.orgId),
        eq(notificationRules.triggerEvent, event),
        eq(notificationRules.enabled, true),
      ),
    });

    for (const rule of rules) {
      const builtin = TEMPLATES[rule.templateId];
      const override = await this.db.db.query.emailTemplates.findFirst({
        where: and(eq(emailTemplates.organizationId, ctx.orgId), eq(emailTemplates.templateId, rule.templateId)),
      });
      if (!builtin && !override) continue;

      const rendered = override
        ? { subject: this.interpolate(override.subject, ctx), html: this.interpolate(override.html, ctx) }
        : builtin!(ctx);
      const payloadHash = createHash('sha256').update(JSON.stringify(ctx)).digest('hex');

      for (const channel of rule.channels ?? ['email']) {
        try {
          if (channel === 'email' && ctx.email) {
            await this.email.send({ to: ctx.email, subject: rendered.subject, html: rendered.html });
          }
          await this.db.db.insert(notificationLog).values({
            organizationId: ctx.orgId, ruleId: rule.id, userId: ctx.userId,
            channel, payloadHash, status: 'sent',
          });
        } catch (err) {
          this.logger.warn(`Notification delivery failed [${channel}] event=${event}: ${err}`);
          await this.db.db.insert(notificationLog).values({
            organizationId: ctx.orgId, ruleId: rule.id, userId: ctx.userId,
            channel, payloadHash, status: 'failed',
          });
        }
      }
    }
  }

  async getRules(orgId: string) {
    await this.seedDefaultRules(orgId).catch(() => {});
    return this.db.db.query.notificationRules.findMany({
      where: eq(notificationRules.organizationId, orgId),
    });
  }

  async toggleRule(orgId: string, id: string, enabled: boolean) {
    const [updated] = await this.db.db
      .update(notificationRules)
      .set({ enabled, updatedAt: new Date() })
      .where(and(eq(notificationRules.id, id), eq(notificationRules.organizationId, orgId)))
      .returning();
    return updated!;
  }

  // Built-in templates only support `{{body}}` — enough for the simple wrapper html they use.
  private interpolate(text: string, ctx: TriggerContext): string {
    return text.replace(/\{\{body\}\}/g, ctx.body);
  }

  /** List every known templateId (built-in + org-specific) with its effective subject/html */
  async getEmailTemplates(orgId: string) {
    const overrides = await this.db.db.query.emailTemplates.findMany({
      where: eq(emailTemplates.organizationId, orgId),
    });
    const overrideMap = new Map(overrides.map(o => [o.templateId, o]));

    return Object.keys(TEMPLATES).map(templateId => {
      const sample = TEMPLATES[templateId]!({ orgId, body: '{{body}}' });
      const override = overrideMap.get(templateId);
      return {
        templateId,
        subject: override?.subject ?? sample.subject,
        html: override?.html ?? sample.html,
        isOverridden: !!override,
      };
    });
  }

  async upsertEmailTemplate(orgId: string, templateId: string, subject: string, html: string) {
    const existing = await this.db.db.query.emailTemplates.findFirst({
      where: and(eq(emailTemplates.organizationId, orgId), eq(emailTemplates.templateId, templateId)),
    });
    if (existing) {
      const [updated] = await this.db.db
        .update(emailTemplates)
        .set({ subject, html, updatedAt: new Date() })
        .where(eq(emailTemplates.id, existing.id))
        .returning();
      return updated!;
    }
    const [created] = await this.db.db
      .insert(emailTemplates)
      .values({ organizationId: orgId, templateId, subject, html })
      .returning();
    return created!;
  }

  async revertEmailTemplate(orgId: string, templateId: string) {
    await this.db.db
      .delete(emailTemplates)
      .where(and(eq(emailTemplates.organizationId, orgId), eq(emailTemplates.templateId, templateId)));
    return { reverted: true };
  }
}
