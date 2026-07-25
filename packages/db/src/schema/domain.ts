import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
  boolean,
  date,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { organizations, users } from './auth';

// ─── Terms ────────────────────────────────────────────────────────────────────
export const terms = pgTable(
  'terms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    name: text('name').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    weekCount: integer('week_count').notNull().default(12),
    status: text('status', { enum: ['planned', 'active', 'closed'] })
      .notNull()
      .default('planned'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('terms_org_id_idx').on(t.organizationId)],
);

// ─── Families ─────────────────────────────────────────────────────────────────
export const families = pgTable(
  'families',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    name: text('name').notNull(),
    contactName: text('contact_name'),
    address: text('address'),
    phone: text('phone'),
    email: text('email'),
    // Consent for automated lesson reminders (the checkbox on the registration
    // form). When false, the 24h reminder worker skips this family entirely.
    // Defaults true so existing families keep getting reminders as before.
    emailRemindersEnabled: boolean('email_reminders_enabled').notNull().default(true),
    // Secret that authorises the family's read-only .ics lesson feed. The URL is
    // the only credential a calendar app can present, so this is a capability
    // token: unguessable, per-family, and revocable by regenerating it. Null
    // until the family first asks for their feed.
    calendarToken: text('calendar_token'),
    autoInvoice: boolean('auto_invoice').notNull().default(false),
    invoiceMode: text('invoice_mode', {
      enum: ['monthly_statement', 'per_lesson'],
    })
      .notNull()
      .default('monthly_statement'),
    balanceCached: integer('balance_cached').notNull().default(0),
    // Short, stable code the family quotes on every bank transfer (e.g. ML-4F2A).
    // It is what lets an imported statement line be matched to a family without
    // anyone reading it by hand. Nullable so existing families backfill lazily.
    paymentReference: text('payment_reference'),
    // ─── Auto-invoicing settings ──────────────────────────────────────────────
    billingStartDate: date('billing_start_date'),
    billingMode: text('billing_mode', { enum: ['prepaid', 'postpaid'] }).notNull().default('postpaid'),
    invoiceDateOffsetDays: integer('invoice_date_offset_days').notNull().default(0),
    dueDateOffsetDays: integer('due_date_offset_days').notNull().default(7),
    invoiceFormat: text('invoice_format', { enum: ['condensed', 'normal', 'expanded'] }).notNull().default('normal'),
    includePreviousBalance: boolean('include_previous_balance').notNull().default(true),
    autoEmailInvoice: boolean('auto_email_invoice').notNull().default(false),
    invoiceFooterNote: text('invoice_footer_note'),
    // ─── Resource-access subscription (separate from lesson billing) ─────────
    resourceAccessPaidUntil: date('resource_access_paid_until'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('families_org_id_idx').on(t.organizationId),
    // Auto-matching a statement line to a family is only sound if the reference
    // identifies exactly one family.
    uniqueIndex('families_org_payment_reference_uidx').on(t.organizationId, t.paymentReference),
    // The calendar feed is looked up by token alone on an unauthenticated route,
    // so it needs an index — and it must resolve to exactly one family, since
    // the token is the only credential the request carries.
    uniqueIndex('families_calendar_token_uidx').on(t.calendarToken),
  ],
);

// ─── Guardians ────────────────────────────────────────────────────────────────
export const guardians = pgTable(
  'guardians',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id),
    relationship: text('relationship').notNull().default('guardian'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('guardians_family_user_uidx').on(t.familyId, t.userId),
    index('guardians_user_id_idx').on(t.userId),
  ],
);

// ─── Students ─────────────────────────────────────────────────────────────────
export const students = pgTable(
  'students',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    familyId: uuid('family_id').notNull().references(() => families.id),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    dob: date('dob'),
    email: text('email'),
    studentUserId: uuid('student_user_id').references(() => users.id),
    status: text('status', { enum: ['trial', 'active', 'paused', 'withdrawn'] })
      .notNull()
      .default('active'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('students_org_status_idx').on(t.organizationId, t.status),
    index('students_family_id_idx').on(t.familyId),
  ],
);

// ─── Staff members ────────────────────────────────────────────────────────────
export const staffMembers = pgTable(
  'staff_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    userId: uuid('user_id').references(() => users.id),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    title: text('title'),
    instruments: text('instruments').array().notNull().default([]),
    defaultDuration: integer('default_duration').notNull().default(60),
    payrollType: text('payroll_type', { enum: ['hourly'] }).notNull().default('hourly'),
    hourlyRate: integer('hourly_rate').notNull().default(0),
    status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('staff_members_org_id_idx').on(t.organizationId)],
);

// ─── Staff privileges ─────────────────────────────────────────────────────────
export const staffPrivileges = pgTable('staff_privileges', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  staffId: uuid('staff_id')
    .notNull()
    .unique()
    .references(() => staffMembers.id, { onDelete: 'cascade' }),
  privileges: jsonb('privileges').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Teacher assignments ──────────────────────────────────────────────────────
export const teacherAssignments = pgTable(
  'teacher_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffMembers.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['primary', 'secondary'] }).notNull().default('primary'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('teacher_assignments_uidx').on(t.staffId, t.studentId),
    index('teacher_assignments_student_idx').on(t.studentId),
  ],
);

// ─── Enrollments ──────────────────────────────────────────────────────────────
export const enrollments = pgTable(
  'enrollments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    studentId: uuid('student_id').notNull().references(() => students.id),
    termId: uuid('term_id').references(() => terms.id),
    instrument: text('instrument').notNull(),
    lessonType: text('lesson_type', { enum: ['private', 'group'] })
      .notNull()
      .default('private'),
    // Identifies which specific group session this is (e.g. "Tuesday 4pm Ensemble") — only set when lessonType = 'group'
    groupName: text('group_name'),
    teacherId: uuid('teacher_id').references(() => staffMembers.id),
    rate: integer('rate').notNull().default(0),
    // Duration (minutes) that `rate` corresponds to — lessons of a different length are prorated against this.
    defaultDuration: integer('default_duration').notNull().default(60),
    scheduleRule: jsonb('schedule_rule'),
    autoRenew: boolean('auto_renew').notNull().default(true),
    status: text('status', { enum: ['trial', 'active', 'paused', 'withdrawn'] })
      .notNull()
      .default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('enrollments_student_id_idx').on(t.studentId),
    index('enrollments_teacher_id_idx').on(t.teacherId),
    index('enrollments_term_id_idx').on(t.termId),
  ],
);

// ─── Instruments ──────────────────────────────────────────────────────────────
// The list offered on the public registration form, editable from Settings so
// adding an instrument doesn't need a code change. Enrollments store the
// instrument as free text, so renaming or removing a row here never orphans
// existing enrollments — it only changes what new registrants can pick.
// An org with no rows falls back to the built-in defaults (see InstrumentsService).
export const instruments = pgTable(
  'instruments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    name: text('name').notNull(),
    // An instrument can be offered as private, group, or both — guitar is both
    // today — so these are two independent flags rather than one lesson type.
    availablePrivate: boolean('available_private').notNull().default(true),
    availableGroup: boolean('available_group').notNull().default(false),
    // Shown under the chips on the registration form when this instrument is
    // picked. Suzuki violin needs it — the package is a group class AND a 1-on-1
    // together, which nobody would guess from a chip labelled "Suzuki violin".
    note: text('note'),
    // Controls the order of the chips on the registration form.
    sortOrder: integer('sort_order').notNull().default(0),
    // Soft-hide: retires an instrument from the form without deleting the row.
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('instruments_org_name_idx').on(t.organizationId, t.name)],
);

// ─── Lesson notes ─────────────────────────────────────────────────────────────
export const notes = pgTable(
  'notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    studentId: uuid('student_id').notNull().references(() => students.id),
    lessonId: uuid('lesson_id'),
    authorId: uuid('author_id').references(() => users.id),
    body: text('body').notNull(),
    attachments: jsonb('attachments').default([]),
    visibility: text('visibility', { enum: ['internal', 'family'] }).notNull().default('family'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notes_student_id_idx').on(t.organizationId, t.studentId),
    index('notes_lesson_id_idx').on(t.lessonId),
  ],
);

// ─── Public resource-library subscribers ───────────────────────────────────────
// People who buy access to the studio's resource library WITHOUT a Music & Life
// account — the no-login product. They subscribe on a public page with just an
// email; on activation we mint an unguessable access token, emailed to them as a
// magic link that opens the public library. Access lasts until `paidUntil`, so a
// lapsed (unrenewed) or cancelled subscriber is revoked automatically the next
// time they open the link. Separate from the family-linked subscription (which
// lives on families.resourceAccessPaidUntil).
export const resourceSubscribers = pgTable(
  'resource_subscribers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    email: text('email').notNull(),
    name: text('name'),
    // Opaque bearer token for the magic access link — the only credential a
    // no-account subscriber has. Unique so a link maps to exactly one subscriber.
    accessToken: text('access_token').notNull().unique(),
    status: text('status', { enum: ['pending', 'active', 'canceled'] }).notNull().default('pending'),
    // Access is granted up to and including this date; NULL until first activated.
    paidUntil: date('paid_until'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One subscriber row per email per studio — re-subscribing updates it rather
    // than creating a duplicate.
    uniqueIndex('resource_subscribers_org_email_uidx').on(t.organizationId, t.email),
  ],
);

// NOTE: `staff_availability` used to live here — an exact duplicate of
// `availability` in schema/scheduling.ts. Nothing in the API ever read it: the
// slot generator, the booking conflict check and every availability endpoint
// all use `availability`. Its only writer was the QA seed, which meant those
// teachers had no bookable hours at all. Dropped in migration 0018.
