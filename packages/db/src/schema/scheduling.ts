import {
  pgTable, uuid, text, timestamp, integer, boolean, jsonb, date, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { organizations, users } from './auth';
import { staffMembers, students, enrollments, terms } from './domain';

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
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    duration: integer('duration').notNull().default(60),
    actualStartedAt: timestamp('actual_started_at', { withTimezone: true }),
    actualEndedAt: timestamp('actual_ended_at', { withTimezone: true }),
    isTrialLesson: boolean('is_trial_lesson').notNull().default(false),
    // The canonical weekly-series slot this lesson was materialised for, set only
    // by the recurrence worker. The worker dedups on THIS (not starts_at), so
    // rescheduling a recurring lesson off its slot no longer leaves the slot
    // looking empty — which used to make the next nightly run regenerate a
    // duplicate at the old time and double-bill the family. Null for one-off
    // (non-recurring) lessons.
    seriesSlotAt: timestamp('series_slot_at', { withTimezone: true }),
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
    // 1st choice (required) + optional 2nd/3rd preferences. Letting a family rank
    // a few times lets staff/teachers slot students back-to-back instead of
    // playing email tag over a single proposed time.
    proposedStartsAt: timestamp('proposed_starts_at', { withTimezone: true }).notNull(),
    proposedStartsAt2: timestamp('proposed_starts_at_2', { withTimezone: true }),
    proposedStartsAt3: timestamp('proposed_starts_at_3', { withTimezone: true }),
    status: text('status', { enum: ['pending','approved','denied'] }).notNull().default('pending'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('reschedule_requests_org_status_idx').on(t.organizationId, t.status)],
);

export const lessonRequests = pgTable(
  'lesson_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    studentId: uuid('student_id').notNull().references(() => students.id),
    enrollmentId: uuid('enrollment_id').references(() => enrollments.id),
    // The teacher who must ultimately confirm one of the ranked times.
    teacherId: uuid('teacher_id').notNull().references(() => staffMembers.id),
    duration: integer('duration').notNull().default(60),
    // Up to three ranked start times (1st required) proposed by the front desk;
    // the teacher picks whichever works. Mirrors reschedule_requests, but for a
    // brand-new booking rather than moving an existing lesson.
    proposedStartsAt: timestamp('proposed_starts_at', { withTimezone: true }).notNull(),
    proposedStartsAt2: timestamp('proposed_starts_at_2', { withTimezone: true }),
    proposedStartsAt3: timestamp('proposed_starts_at_3', { withTimezone: true }),
    // When every proposed time clashes or falls outside the teacher's hours, the
    // teacher's only move used to be "Decline" — a dead end that sent the family
    // back to square one. They can now counter with times that do work, which
    // the front desk confirms on the family's behalf.
    counterStartsAt: timestamp('counter_starts_at', { withTimezone: true }),
    counterStartsAt2: timestamp('counter_starts_at_2', { withTimezone: true }),
    counterStartsAt3: timestamp('counter_starts_at_3', { withTimezone: true }),
    notes: text('notes'),
    // A family self-booking books its 1st-choice time IMMEDIATELY (so the family
    // leaves with a confirmed lesson) while still giving the teacher a veto. Such
    // a request starts life as 'auto_confirmed': the lesson already exists
    // (createdLessonId is set at creation), and the teacher may Accept (→confirmed,
    // no change), Move to the 2nd/3rd choice (→confirmed, lesson rescheduled), or
    // Decline (→declined, lesson cancelled as cancelled_teacher — no charge, no
    // credit lost). Front-desk-proposed requests still start 'pending' with no
    // lesson until a time is confirmed.
    status: text('status', { enum: ['pending','counter_proposed','confirmed','declined','auto_confirmed'] }).notNull().default('pending'),
    // True when this booking set up a recurring weekly series (the enrollment's
    // scheduleRule). A teacher declining a recurring auto-booking clears that rule
    // so the nightly generator stops materialising the series, not just the one
    // instant-booked occurrence.
    isRecurring: boolean('is_recurring').notNull().default(false),
    // Only meaningful when isRecurring — the family's chosen end date for the
    // series (null = ongoing, matching the "no end" default elsewhere). Held
    // here until the request is confirmed, since nothing about a pending
    // family booking touches the enrollment's own scheduleRule anymore.
    recurringEndDate: date('recurring_end_date'),
    requestedBy: uuid('requested_by').notNull().references(() => users.id),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    // The lesson created once the teacher confirms a time (null while pending/declined).
    createdLessonId: uuid('created_lesson_id').references(() => lessons.id),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('lesson_requests_org_status_idx').on(t.organizationId, t.status)],
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
