import {
  pgTable, uuid, text, timestamp, boolean, jsonb, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { organizations, users } from './auth';
import { staffMembers } from './domain';

// ─── In-app notifications ───────────────────────────────────────────────────
// A lightweight in-app mirror of NotificationsService.trigger() — written
// alongside (never instead of) the email send, so a user sees a banner even if
// they never check that inbox. `body` is always plain text (HTML stripped at
// write time), since it's rendered directly, not through an email client.
export const inAppNotifications = pgTable(
  'in_app_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    title: text('title').notNull(),
    body: text('body').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('in_app_notifications_user_idx').on(t.userId, t.readAt)],
);

// ─── Messaging ────────────────────────────────────────────────────────────────
export const threads = pgTable(
  'threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    subject: text('subject').notNull(),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('threads_org_idx').on(t.organizationId)],
);

export const threadParticipants = pgTable(
  'thread_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id').notNull().references(() => threads.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('thread_participants_uidx').on(t.threadId, t.userId),
    index('thread_participants_user_idx').on(t.userId),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    threadId: uuid('thread_id').notNull().references(() => threads.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id').notNull().references(() => users.id),
    body: text('body').notNull(),
    // [{ fileId, name, mime, size }] — photos and short videos shared in the
    // conversation. Families had no way to send a teacher a recording of the
    // week's practice; staff could only share media through a lesson note,
    // which is one-directional.
    attachments: jsonb('attachments').notNull().default([]),
    readBy: jsonb('read_by').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('messages_thread_idx').on(t.threadId, t.createdAt)],
);

// ─── Notifications ─────────────────────────────────────────────────────────────
export const notificationRules = pgTable(
  'notification_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    triggerEvent: text('trigger_event').notNull(),
    conditions: jsonb('conditions').default({}),
    channels: text('channels').array().notNull().default(['email']),
    templateId: text('template_id').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // seedDefaultRules() lazily inserts one default rule per event on first
    // trigger() — without this, two concurrent trigger() calls for the same
    // event can both see "no rule yet" and both insert, and every later event
    // then delivers (and in-app-notifies) twice per matching duplicate.
    uniqueIndex('notification_rules_org_event_uidx').on(t.organizationId, t.triggerEvent),
  ],
);

export const notificationLog = pgTable(
  'notification_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').references(() => organizations.id),
    ruleId: uuid('rule_id').references(() => notificationRules.id),
    userId: uuid('user_id').references(() => users.id),
    channel: text('channel').notNull(),
    payloadHash: text('payload_hash'),
    status: text('status', { enum: ['sent', 'failed', 'skipped'] }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notification_log_org_idx').on(t.organizationId, t.sentAt)],
);

// ─── Registrations ────────────────────────────────────────────────────────────
export const registrations = pgTable(
  'registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    payload: jsonb('payload').notNull(),
    status: text('status', { enum: ['pending', 'approved', 'denied'] }).notNull().default('pending'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    denyReason: text('deny_reason'),
    idempotencyKey: text('idempotency_key').unique(),
  },
  (t) => [index('registrations_org_status_idx').on(t.organizationId, t.status)],
);

// ─── Email templates (admin-editable overrides of the hardcoded defaults) ─────
export const emailTemplates = pgTable(
  'email_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    templateId: text('template_id').notNull(),
    subject: text('subject').notNull(),
    html: text('html').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('email_templates_org_template_uidx').on(t.organizationId, t.templateId)],
);

// ─── Studio news / announcements ───────────────────────────────────────────────
export const newsPosts = pgTable(
  'news_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    title: text('title').notNull(),
    body: text('body').notNull(),
    authorId: uuid('author_id').references(() => users.id),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('news_posts_org_published_idx').on(t.organizationId, t.publishedAt)],
);

// ─── Leads ────────────────────────────────────────────────────────────────────
export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    name: text('name').notNull(),
    contact: text('contact'),
    instrumentInterest: text('instrument_interest'),
    source: text('source'),
    status: text('status', { enum: ['new', 'contacted', 'converted', 'lost'] }).notNull().default('new'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('leads_org_status_idx').on(t.organizationId, t.status)],
);
