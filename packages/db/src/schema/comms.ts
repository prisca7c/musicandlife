import {
  pgTable, uuid, text, timestamp, boolean, jsonb, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { organizations, users } from './auth';
import { staffMembers } from './domain';

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
    readBy: jsonb('read_by').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('messages_thread_idx').on(t.threadId, t.createdAt)],
);

// ─── Notifications ─────────────────────────────────────────────────────────────
export const notificationRules = pgTable('notification_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  triggerEvent: text('trigger_event').notNull(),
  conditions: jsonb('conditions').default({}),
  channels: text('channels').array().notNull().default(['email']),
  templateId: text('template_id').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

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
