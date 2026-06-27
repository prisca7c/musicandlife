import {
  pgTable, uuid, text, timestamp, integer, index,
} from 'drizzle-orm/pg-core';
import { organizations, users } from './auth';
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
    // ─── Filter/search tags (independent of `scope`, which is the role gate) ──
    instrument: text('instrument'),
    teacherId: uuid('teacher_id').references(() => staffMembers.id),
    studentId: uuid('student_id').references(() => students.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('resources_org_scope_idx').on(t.organizationId, t.scope)],
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

