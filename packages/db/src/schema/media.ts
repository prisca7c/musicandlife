import {
  pgTable, uuid, text, timestamp, integer, boolean, jsonb, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { organizations, users } from './auth';
import { lessons } from './scheduling';
import { students, staffMembers } from './domain';

// ─── Files (metadata) ─────────────────────────────────────────────────────────
export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id),
  key: text('key').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  originalName: text('original_name'),
  checksum: text('checksum'),
  ownerId: uuid('owner_id').references(() => users.id),
  scope: text('scope').notNull().default('private'),
  virusScanStatus: text('virus_scan_status', { enum: ['pending', 'clean', 'infected'] }).notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Resources ────────────────────────────────────────────────────────────────
export const resources = pgTable(
  'resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    title: text('title').notNull(),
    description: text('description'),
    type: text('type', { enum: ['file', 'link', 'note'] }).notNull().default('link'),
    fileId: uuid('file_id').references(() => files.id),
    url: text('url'),
    scope: text('scope', { enum: ['studio', 'teacher', 'family', 'student'] }).notNull().default('studio'),
    ownerId: uuid('owner_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('resources_org_scope_idx').on(t.organizationId, t.scope)],
);

// ─── AI / Recording pipeline (§7.1) ──────────────────────────────────────────
export const recordings = pgTable(
  'recordings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    lessonId: uuid('lesson_id').notNull().references(() => lessons.id),
    studentId: uuid('student_id').notNull().references(() => students.id),
    fileId: uuid('file_id').references(() => files.id),
    mediaType: text('media_type', { enum: ['audio', 'video'] }).notNull(),
    durationSeconds: integer('duration_seconds'),
    consent: boolean('consent').notNull(),
    consentBy: uuid('consent_by').references(() => users.id),
    consentAt: timestamp('consent_at', { withTimezone: true }),
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    status: text('status', {
      enum: ['uploaded', 'processing', 'ready', 'archived', 'deleted'],
    }).notNull().default('uploaded'),
    retainUntil: timestamp('retain_until', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archiveFileKey: text('archive_file_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('recordings_lesson_idx').on(t.lessonId),
    index('recordings_retain_until_idx').on(t.organizationId, t.retainUntil),
  ],
);

export const transcripts = pgTable('transcripts', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  recordingId: uuid('recording_id').notNull().references(() => recordings.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull().default('stub'),
  language: text('language').notNull().default('en'),
  text: text('text').notNull(),
  segments: jsonb('segments').default([]),
  modelMeta: jsonb('model_meta').default({}),
  status: text('status', { enum: ['pending', 'completed', 'failed'] }).notNull().default('completed'),
  retainUntil: timestamp('retain_until', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const lessonSummaries = pgTable('lesson_summaries', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  lessonId: uuid('lesson_id').notNull().references(() => lessons.id),
  recordingId: uuid('recording_id').references(() => recordings.id),
  transcriptId: uuid('transcript_id').references(() => transcripts.id),
  provider: text('provider').notNull().default('stub'),
  summary: text('summary').notNull(),
  modelMeta: jsonb('model_meta').default({}),
  generatedBy: uuid('generated_by').references(() => users.id),
  trigger: text('trigger', { enum: ['manual'] }).notNull().default('manual'),
  retainUntil: timestamp('retain_until', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const aiJobs = pgTable(
  'ai_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    lessonId: uuid('lesson_id').references(() => lessons.id),
    recordingId: uuid('recording_id').references(() => recordings.id),
    kind: text('kind', { enum: ['transcribe', 'summarize'] }).notNull(),
    provider: text('provider').notNull().default('stub'),
    status: text('status', { enum: ['queued', 'running', 'succeeded', 'failed'] }).notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    idempotencyKey: text('idempotency_key').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_jobs_recording_idx').on(t.recordingId, t.status)],
);

// ─── Repertoire / LMS ─────────────────────────────────────────────────────────
export const repertoirePieces = pgTable(
  'repertoire_pieces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    studentId: uuid('student_id').notNull().references(() => students.id),
    teacherId: uuid('teacher_id').references(() => staffMembers.id),
    title: text('title').notNull(),
    composer: text('composer'),
    instrument: text('instrument'),
    status: text('status', { enum: ['learning', 'polishing', 'performance_ready', 'completed'] }).notNull().default('learning'),
    notes: text('notes'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('repertoire_student_idx').on(t.organizationId, t.studentId)],
);

export const practiceLogs = pgTable('practice_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  studentId: uuid('student_id').notNull().references(() => students.id),
  pieceId: uuid('piece_id').references(() => repertoirePieces.id),
  durationMinutes: integer('duration_minutes').notNull(),
  date: text('date').notNull(),
  notes: text('notes'),
  loggedBy: uuid('logged_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
