import { Injectable, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { createHash } from 'crypto';
import { notificationRules, notificationLog, organizations } from '@music-life/db';
import { DbService } from '../db/db.service';
import { EmailPort } from '../email/ports/email.port';
import { SmsPort } from '../sms/ports/sms.port';

export type TriggerEvent =
  | 'registration.received'
  | 'registration.approved'
  | 'registration.denied'
  | 'lesson.reminder_24h'
  | 'lesson.reminder_2h'
  | 'lesson.cancelled'
  | 'lesson.rescheduled'
  | 'invoice.sent'
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
  'lesson.reminder_2h': (ctx) => ({
    subject: `Lesson in 2 hours`,
    html: `<p>Your lesson starts in approximately 2 hours.</p><p>${ctx.body}</p>`,
  }),
  'lesson.cancelled': (ctx) => ({
    subject: 'Lesson cancelled',
    html: `<p>A lesson has been cancelled.</p><p>${ctx.body}</p>`,
  }),
  'invoice.sent': (ctx) => ({
    subject: ctx.subject ?? 'New invoice from Music & Life',
    html: `<p>An invoice has been issued to your account.</p><p>${ctx.body}</p>`,
  }),
};

// Default rules seeded for every new org
export const DEFAULT_RULES: Array<{
  triggerEvent: TriggerEvent;
  templateId: string;
  channels: string[];
}> = [
  { triggerEvent: 'registration.received', templateId: 'registration.received.admin', channels: ['email'] },
  { triggerEvent: 'registration.approved', templateId: 'registration.approved.family', channels: ['email'] },
  { triggerEvent: 'registration.denied', templateId: 'registration.denied.family', channels: ['email'] },
  { triggerEvent: 'lesson.reminder_24h', templateId: 'lesson.reminder_24h', channels: ['email'] },
  { triggerEvent: 'lesson.reminder_2h', templateId: 'lesson.reminder_2h', channels: ['sms'] },
  { triggerEvent: 'lesson.cancelled', templateId: 'lesson.cancelled', channels: ['email'] },
  { triggerEvent: 'invoice.sent', templateId: 'invoice.sent', channels: ['email'] },
];

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly db: DbService,
    private readonly email: EmailPort,
    private readonly sms: SmsPort,
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
      const template = TEMPLATES[rule.templateId];
      if (!template) continue;

      const rendered = template(ctx);
      const payloadHash = createHash('sha256').update(JSON.stringify(ctx)).digest('hex');

      for (const channel of rule.channels ?? ['email']) {
        try {
          if (channel === 'email' && ctx.email) {
            await this.email.send({ to: ctx.email, subject: rendered.subject, html: rendered.html });
          } else if (channel === 'sms' && ctx.phone) {
            await this.sms.send({ to: ctx.phone, body: rendered.subject });
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
}
