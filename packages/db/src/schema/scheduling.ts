import {
  pgTable, uuid, text, timestamp, integer, boolean, jsonb, date, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { organizations, users } from './auth';
import { staffMembers, students, enrollments, terms, rooms } from './domain';

export const availability = pgTable(
  'availability',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    staffId: uuid('staff_id').notNull().references(() => staffMembers.id, { onDelete: 'cascade' }),
    weekday: text('weekday', { enum: ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] }).notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('availability_staff_id_idx').on(t.staffId)],
);

export const blockedTime = pgTable(
  'blocked_time',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    staffId: uuid('staff_id').notNull().references(() => staffMembers.id, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('blocked_time_staff_idx').on(t.staffId, t.startsAt)],
);

export const lessons = pgTable(
  'lessons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    enrollmentId: uuid('enrollment_id').references(() => enrollments.id),
    termId: uuid('term_id').references(() => terms.id),
    teacherId: uuid('teacher_id').references(() => staffMembers.id),
    studentId: uuid('student_id').notNull().references(() => students.id),
    roomId: uuid('room_id').references(() => rooms.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    duration: integer('duration').notNull().default(60),
    actualStartedAt: timestamp('actual_started_at', { withTimezone: true }),
    actualEndedAt: timestamp('actual_ended_at', { withTimezone: true }),
    isTrialLesson: boolean('is_trial_lesson').notNull().default(false),
    status: text('status', {
      enum: ['scheduled','completed','cancelled_makeup','cancelled_no_makeup','cancelled_no_pay','cancelled_teacher','makeup'],
    }).notNull().default('scheduled'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    meetingLink: text('meeting_link'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('lessons_org_teacher_starts_idx').on(t.organizationId, t.teacherId, t.startsAt),
    index('lessons_org_student_starts_idx').on(t.organizationId, t.studentId, t.startsAt),
    index('lessons_org_room_starts_idx').on(t.organizationId, t.roomId, t.startsAt),
    index('lessons_org_status_idx').on(t.organizationId, t.status),
  ],
);

export const rescheduleRequests = pgTable(
  'reschedule_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    lessonId: uuid('lesson_id').notNull().references(() => lessons.id),
    requestedBy: uuid('requested_by').notNull().references(() => users.id),
    proposedStartsAt: timestamp('proposed_starts_at', { withTimezone: true }).notNull(),
    proposedRoomId: uuid('proposed_room_id').references(() => rooms.id),
    status: text('status', { enum: ['pending','approved','denied'] }).notNull().default('pending'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('reschedule_requests_org_status_idx').on(t.organizationId, t.status)],
);

export const attendance = pgTable(
  'attendance',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    lessonId: uuid('lesson_id').notNull().references(() => lessons.id, { onDelete: 'cascade' }).unique(),
    status: text('status', { enum: ['present','absent_makeup','absent_no_makeup','absent_no_pay','cancelled_teacher'] }).notNull(),
    markedBy: uuid('marked_by').references(() => users.id),
    markedAt: timestamp('marked_at', { withTimezone: true }).notNull().defaultNow(),
    actualStartedAt: timestamp('actual_started_at', { withTimezone: true }),
    actualEndedAt: timestamp('actual_ended_at', { withTimezone: true }),
  },
);
