import {
  pgTable, uuid, text, timestamp, integer, real, boolean, jsonb, date, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
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

// ─── Bank-transfer reconciliation ─────────────────────────────────────────────
// The studio is paid by bank transfer (no card fees), which means nothing tells
// the system when money actually lands. A parent tapping "I've sent the
// transfer" therefore records a CLAIM, not a payment — the ledger only moves
// once the claim is matched against a real line on the bank statement.
//
// Matching is automatic: every family gets a short, stable reference they quote
// on the transfer, and imported statement rows are matched on that reference
// plus the amount. Staff only ever look at what fails to match.
export const paymentClaims = pgTable(
  'payment_claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    familyId: uuid('family_id').notNull().references(() => families.id),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    amount: integer('amount').notNull(),
    // Snapshot of the family's reference at claim time, so a later reference
    // change can't orphan an old claim.
    reference: text('reference').notNull(),
    // pending  → waiting for a matching statement line
    // confirmed→ matched (auto or by staff); a payment row exists
    // rejected → staff decided the money never arrived
    status: text('status', { enum: ['pending', 'confirmed', 'rejected'] }).notNull().default('pending'),
    matchedTransactionId: uuid('matched_transaction_id'),
    paymentId: uuid('payment_id').references(() => payments.id),
    confirmedBy: uuid('confirmed_by').references(() => users.id),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    // Set when staff confirm/reject by hand rather than the importer matching it.
    resolvedManually: boolean('resolved_manually').notNull().default(false),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('payment_claims_org_status_idx').on(t.organizationId, t.status),
    index('payment_claims_family_idx').on(t.organizationId, t.familyId),
    // One open claim per invoice — repeat taps must not queue a second one.
    uniqueIndex('payment_claims_open_invoice_uidx')
      .on(t.invoiceId)
      .where(sql`${t.status} = 'pending' AND ${t.invoiceId} IS NOT NULL`),
  ],
);

// One row per line on an imported bank statement. Kept permanently so the same
// statement can be re-imported without double-crediting anyone.
export const bankTransactions = pgTable(
  'bank_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    bookedOn: date('booked_on').notNull(),
    // Pence, always positive — only money IN is imported.
    amount: integer('amount').notNull(),
    reference: text('reference'),
    description: text('description'),
    // Hash of the raw statement line. Re-importing an overlapping statement is a
    // normal thing to do (monthly exports overlap at the edges), so the importer
    // relies on this to skip rows it has already seen.
    fingerprint: text('fingerprint').notNull(),
    matchedFamilyId: uuid('matched_family_id').references(() => families.id),
    matchedClaimId: uuid('matched_claim_id').references(() => paymentClaims.id),
    paymentId: uuid('payment_id').references(() => payments.id),
    // matched     → credited to a family
    // unmatched   → no reference/amount hit; needs a human
    // ignored     → staff dismissed it (refund, transfer between own accounts…)
    status: text('status', { enum: ['matched', 'unmatched', 'ignored'] }).notNull().default('unmatched'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('bank_transactions_org_fingerprint_uidx').on(t.organizationId, t.fingerprint),
    index('bank_transactions_org_status_idx').on(t.organizationId, t.status),
  ],
);

// ─── Revolut card payments ──────────────────────────────────────────────────
// Alongside bank transfer — a family can pay a public invoice by card via a
// Revolut-hosted checkout page (card details never touch our servers). One
// row per checkout attempt, so a family reopening the same invoice and
// retrying gets a fresh order rather than reusing a stale/expired one; the
// webhook looks a completed order up by revolutOrderId to know which
// invoice to mark paid.
export const revolutOrders = pgTable(
  'revolut_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    invoiceId: uuid('invoice_id').notNull().references(() => invoices.id),
    revolutOrderId: text('revolut_order_id').notNull(),
    amount: integer('amount').notNull(),
    status: text('status', { enum: ['pending', 'completed', 'failed', 'cancelled'] }).notNull().default('pending'),
    paymentId: uuid('payment_id').references(() => payments.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('revolut_orders_revolut_order_id_uidx').on(t.revolutOrderId),
    index('revolut_orders_invoice_idx').on(t.invoiceId),
  ],
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
  (t) => [
    index('payroll_runs_staff_idx').on(t.organizationId, t.staffId),
    // One payroll run per teacher per period. The service pre-checks for an
    // existing run, but that check-then-insert races: two concurrent creates
    // (or a batch overlapping a single create) could both pass it and draft two
    // runs over the identical lessons — paying the teacher twice if both are
    // approved. This constraint makes the database the single source of truth so
    // the second insert can never land.
    uniqueIndex('payroll_runs_period_uq').on(
      t.organizationId, t.staffId, t.periodStart, t.periodEnd,
    ),
  ],
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
