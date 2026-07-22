import {
  pgTable, uuid, text, timestamp, integer, real, boolean, jsonb, date, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { organizations, users } from './auth';
import { families, students, staffMembers, terms, enrollments } from './domain';
import { lessons } from './scheduling';
import { files } from './media';

// ─── Invoices ─────────────────────────────────────────────────────────────────
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    familyId: uuid('family_id').notNull().references(() => families.id),
    mode: text('mode', { enum: ['monthly_statement', 'per_lesson'] }).notNull(),
    termId: uuid('term_id').references(() => terms.id),
    number: text('number').notNull(),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    issuedOn: date('issued_on').notNull(),
    dueDate: date('due_date').notNull(),
    status: text('status', { enum: ['draft', 'sent', 'paid', 'void'] }).notNull().default('draft'),
    total: integer('total').notNull().default(0),
    tax: integer('tax').notNull().default(0),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('invoices_org_number_uidx').on(t.organizationId, t.number),
    index('invoices_org_family_idx').on(t.organizationId, t.familyId, t.status),
  ],
);

export const invoiceLineItems = pgTable('invoice_line_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  lessonId: uuid('lesson_id').references(() => lessons.id),
  description: text('description').notNull(),
  amount: integer('amount').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Ledger ───────────────────────────────────────────────────────────────────
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    familyId: uuid('family_id').notNull().references(() => families.id),
    type: text('type', { enum: ['charge', 'payment', 'credit', 'adjustment'] }).notNull(),
    amount: integer('amount').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    // The lesson a per-lesson auto-charge was posted for. Lets an attendance
    // change find and reverse the exact charge it originally created (and dedupe
    // so one lesson never posts two charges).
    lessonId: uuid('lesson_id').references(() => lessons.id),
    description: text('description'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ledger_entries_family_idx').on(t.organizationId, t.familyId, t.occurredAt),
    index('ledger_entries_lesson_idx').on(t.lessonId),
  ],
);

// ─── Payments ─────────────────────────────────────────────────────────────────
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    familyId: uuid('family_id').notNull().references(() => families.id),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    method: text('method', { enum: ['bank_transfer', 'cash', 'card', 'other'] }).notNull(),
    amount: integer('amount').notNull(),
    providerRef: text('provider_ref'),
    idempotencyKey: text('idempotency_key').unique(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('payments_family_idx').on(t.organizationId, t.familyId)],
);

// ─── Payroll ──────────────────────────────────────────────────────────────────
export const payrollRuns = pgTable(
  'payroll_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    staffId: uuid('staff_id').notNull().references(() => staffMembers.id),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    // Fractional by nature — a 30-minute lesson is 0.5h. An integer column made
    // `run-all` fail with a 500 (`invalid input syntax for type integer: "0.5"`)
    // for every teacher whose period contained a part-hour lesson.
    hoursElapsed: real('hours_elapsed').notNull().default(0),
    hourlyRate: integer('hourly_rate').notNull(),
    gross: integer('gross').notNull().default(0),
    status: text('status', { enum: ['draft', 'approved', 'paid'] }).notNull().default('draft'),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('payroll_runs_staff_idx').on(t.organizationId, t.staffId)],
);

export const payrollItems = pgTable('payroll_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  payrollRunId: uuid('payroll_run_id').notNull().references(() => payrollRuns.id, { onDelete: 'cascade' }),
  lessonId: uuid('lesson_id').references(() => lessons.id),
  type: text('type', { enum: ['lesson', 'late_cancellation'] }).notNull(),
  minutesElapsed: integer('minutes_elapsed').notNull(),
  amount: integer('amount').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Expenses ─────────────────────────────────────────────────────────────────
export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    staffId: uuid('staff_id').references(() => staffMembers.id),
    category: text('category').notNull(),
    amount: integer('amount').notNull(),
    mileageKm: integer('mileage_km'),
    date: date('date').notNull(),
    description: text('description'),
    receiptFileId: uuid('receipt_file_id').references(() => files.id),
    status: text('status', { enum: ['pending', 'approved', 'rejected'] }).notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('expenses_staff_idx').on(t.organizationId, t.staffId)],
);

// ─── Lesson credits (unified pool: prepaid + makeup) ──────────────────────────
// "lessons" in the UI. Prepaid = bought upfront. Makeup = earned from a cancelled lesson.
// Credits never expire. Pool is per-student.
export const lessonCredits = pgTable(
  'lesson_credits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    studentId: uuid('student_id').notNull().references(() => students.id),
    enrollmentId: uuid('enrollment_id').references(() => enrollments.id),
    // prepaid = paid for in advance; makeup = earned when a lesson is cancelled with ≥24h notice
    type: text('type', { enum: ['prepaid', 'makeup'] }).notNull(),
    sourceLessonId: uuid('source_lesson_id').references(() => lessons.id),
    sourcePaymentId: uuid('source_payment_id').references(() => payments.id),
    usedInLessonId: uuid('used_in_lesson_id').references(() => lessons.id),
    status: text('status', { enum: ['available', 'used'] }).notNull().default('available'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('lesson_credits_student_status_idx').on(t.studentId, t.status),
    index('lesson_credits_org_idx').on(t.organizationId),
  ],
);

// ─── Rate change requests ──────────────────────────────────────────────────────
export const rateChangeRequests = pgTable('rate_change_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  staffId: uuid('staff_id').notNull().references(() => staffMembers.id),
  currentRate: integer('current_rate').notNull(),
  requestedRate: integer('requested_rate').notNull(),
  status: text('status', { enum: ['pending', 'approved', 'denied'] }).notNull().default('pending'),
  decidedBy: uuid('decided_by').references(() => users.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
