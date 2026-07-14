import { Injectable, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { createHash } from 'crypto';
import { notificationRules, notificationLog, organizations, emailTemplates } from '@music-life/db';
import { DbService } from '../db/db.service';
import { EmailPort } from '../email/ports/email.port';

export type TriggerEvent =
  | 'registration.received'
  | 'registration.submitted'
  | 'registration.approved'
  | 'registration.denied'
  | 'lesson.reminder_24h'
  | 'lesson.cancelled'
  | 'lesson.rescheduled'
  | 'invoice.sent'
  | 'invoice.preview_summary'
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

// Built-in templates keyed by templateId
const TEMPLATES: Record<string, (ctx: TriggerContext) => { subject: string; html: string }> = {
  'registration.received.admin': (ctx) => ({
    subject: 'New registration received',
    html: `<p>A new student registration has been submitted and is pending your review.</p><p>${ctx.body}</p>`,
  }),
  'registration.submitted.family': (ctx) => ({
    subject: 'We received your registration — Music & Life',
    html: `<p>Thank you for registering with Music &amp; Life!</p><p>${ctx.body}</p><p>Our team will review your registration within 2–3 business days. Once it's approved, you'll receive a welcome email with your portal login details.</p><p>If you have any questions in the meantime, just reply to this email.</p>`,
  }),
  'registration.approved.family': (ctx) => ({
    subject: 'Welcome to Music & Life!',
    html: `<p>Your registration has been approved. You can now log in to your portal.</p><p>${ctx.body}</p>`,
  }),
  'registration.denied.family': (ctx) => ({
    subject: 'Registration update',
    html: `<p>Unfortunately your registration could not be approved at this time.</p><p>${ctx.body}</p>`,
  }),
  'lesson.reminder_24h': (ctx) => ({
    subject: `Lesson reminder — tomorrow`,
    html: `<p>This is a reminder that you have a lesson tomorrow.</p><p>${ctx.body}</p>`,
  }),
  'lesson.cancelled': (ctx) => ({
    subject: 'Lesson cancelled',
    html: `<p>A lesson has been cancelled.</p><p>${ctx.body}</p>`,
  }),
  'lesson.rescheduled': (ctx) => ({
    subject: 'Your lesson has been rescheduled',
    html: `<p>A lesson has been rescheduled to a new time.</p><p>${ctx.body}</p><p>If this new time doesn't work for you, please get in touch and we'll sort it out.</p>`,
  }),
  'invoice.sent': (ctx) => ({
    subject: ctx.subject ?? 'New invoice from Music & Life',
    html: `<p>An invoice has been issued to your account.</p><p>${ctx.body}</p>`,
  }),
  'invoice.preview_summary': (ctx) => ({
    subject: ctx.subject ?? 'Upcoming auto-invoices',
    html: `<p>The following auto-invoices are scheduled to go out soon.</p><p>${ctx.body}</p>`,
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
  { triggerEvent: 'invoice.sent', templateId: 'invoice.sent', channels: ['email'] },
  { triggerEvent: 'invoice.preview_summary', templateId: 'invoice.preview_summary', channels: ['email'] },
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
