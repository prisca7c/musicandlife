# Music & Life OS — SaaS Architecture & Migration Design

**Status:** Draft for approval · **Date:** 2026-06-03
**Author:** Engineering (Staff SWE / Solutions Architect / Security / DevOps / DB)
**Scope of this document:** Analysis + architecture + RBAC + phased plan. **No implementation until sign-off.**

---

## 0. Decisions locked in (from requirements review)

| Area | Decision | Implication |
|---|---|---|
| Tenancy | **Multi-tenant-ready, seed one studio** | Every domain table carries `organization_id` and isolation is enforced from day one. We operate a single org ("Music & Life") at launch but never have to refactor for the second. |
| Payments | **Ledger/invoice tracking now; Stripe adapter seam later** | We build the billing domain (invoices, ledger entries, payments, payroll) as first-class records. A `PaymentProvider` port exists with a `ManualProvider` impl now; `StripeProvider` slots in later with zero domain changes. |
| External integrations (only these) | **Email** via **Resend**; **calendar sync one-way** (push studio → teacher Google/Outlook); **meeting-link generation** (Zoom/Meet); **SMS = placeholder port, undecided** | Infrastructure ports behind interfaces. SMS adapter is stubbed (logs payload) until you choose native vs. vendor. Everything else in-house. |
| Built in-house | Automation/workflow engine, file-storage abstraction, **self-hosted** AI assessment + transcription pipeline, AI summaries | Core product, under our control. AI runs self-hosted at launch; may switch to a managed model later (sits behind `AiPort`). |
| Migration tool | **Drizzle** | Explicit SQL + typed queries. |
| Next step | **Deliver this doc, await approval** | Implementation begins only after this is approved. **Do not start Phase 0 yet.** |

### 0.1 Confirmed business context & environment

| Item | Confirmed value |
|---|---|
| Business model | Single in-person studio, **Pinner, Greater London, UK**. Multi-tenant-ready schema, one org seeded. |
| Locale | Timezone **Europe/London**; currency **GBP** (stored as integer pence); UK date formats. |
| Compliance / residency | **UK standards** — UK GDPR + ICO guidance; data hosted in **UK/EU** region (Postgres, Redis, S3, AI all UK/EU-resident). |
| Launch | **Green-field** — no data import. |
| Rooms | **5 rooms** (one per the 5 teachers) — modeled as a real `rooms` entity for conflict checks. |
| Payroll | **Hourly only** at launch. Payroll module lives **under "Teachers & Staff,"** not a separate Finance section. |
| Billing | **Per-lesson charges** with the cancellation policy in §0.2. |
| Student accounts | **No age threshold.** Student with an email gets their own portal login; student without an email → the **guardian** accesses the portal on their behalf. |
| Makeup credits | **Never expire.** |

### 0.2 Confirmed lesson cancellation & charge policy

| Event | Charge to family | Pay teacher | Makeup credit |
|---|---|---|---|
| Student cancels **< 24h** before class | **Yes** (full charge) | **Yes** | **No** |
| Student cancels **≥ 24h** before class | No | No | **Yes** (issued to student) |
| **Teacher** cancels | No | No | **Yes** (issued to student) |

### 0.3 Confirmed reschedule policy

- A **student/guardian** may **request** a reschedule, constrained to the assigned teacher's available slots. The request is **pending** until an **admin or that teacher approves or denies** it.
- A reschedule request must be made **at least 24h before the lesson starts**; requests inside the 24h window are rejected (and fall under the §0.2 cancellation policy instead). **No cap** on how many requests a student may make.
- An **admin or teacher** may **directly reschedule** a student (no approval step, not bound by the 24h notice).
- Reschedules are validated against teacher availability **and room availability** (5 rooms) to prevent conflicts.

### 0.4 Confirmed billing, scheduling & AI details

| Item | Confirmed value |
|---|---|
| VAT | **No VAT handling** — studio is not VAT-registered; invoices carry no VAT (field kept but disabled). |
| Invoice modes | **Both supported** — a per-family/org setting chooses **monthly statement** (aggregate the term/month's lessons) or **per-lesson invoice**. Ledger always records per-lesson charges; the setting only changes how invoices are grouped. |
| Scheduling model | **Per term / block** — a term is **12 weeks**. The schedule and makeup credits are generated within the active term. |
| Term roll-over | **Auto-enrol** into the next term, carrying the same slot/teacher, **unless** the parent/student stops lessons. A job provisions next-term enrolments + lessons before the term starts. |
| Payment terms | Invoice **due date = 7 days** from issue. **No late-fee** policy. |
| Payroll basis | Hourly on **actual elapsed lesson time** (not scheduled duration). **Prep/admin hours do not count.** < 24h student cancellations are still paid per §0.2 (paid at the scheduled duration since no lesson elapses). |
| AI summaries | **Optional, teacher-triggered** — a teacher may attach an **audio or video** recording to a lesson and press an "AI summary" button. No recording ⇒ no summary; nothing runs automatically. **Starts as a stub**, behind provider interfaces (see §7.1) so a Whisper-class transcriber + production LLM plug in later with no refactor. |

### 0.5 Confirmed data retention & archival (UK GDPR)

| Data | Live retention | After | Access while archived | Subject download |
|---|---|---|---|---|
| Recordings, transcripts, summaries (per student) | **1 month** live | **Archived** to cold/restricted storage | **Admin/teacher only**, "break-glass" access if genuinely necessary (audited) | Student/guardian can **download** recordings, transcripts & summaries **before** archival |
| Ex-student records (whole account) | **30 days** after leaving | **Hard-deleted** | — | — |

---

## 1. What the prototype is

Two static HTML files, fully client-side, with seeded mock data and no backend:

- **`music-life-registration.html`** — public 4-step registration funnel (Student → Family → Instruments → Review → Success). Supports "new family" vs. "existing family" search, instrument multi-select (one-on-one + group), reminder preferences (email/SMS), and a client-side-only submit that `console.log`s a payload.
- **`music-life-os-enhanced.html`** — the operator app. A login/role-switch screen feeds three portals (**Admin**, **Teacher**, **Family**) rendered from a single `NAV` config. 228 students are procedurally generated; families are derived by grouping students; staff, transactions, invoices, attendance, leads, resources, and messages are all mock. A granular per-teacher **privilege object** already exists (`defaultTeacherPrivileges()` / `adminPrivileges()`) — this is the seed of our RBAC model.

**Key truth:** all "security," role gating, and business logic currently live in the browser. The entire point of this migration is to move that authority to the backend and make the client a thin view.

---

## 2. Feature & workflow extraction

### 2.1 Public / pre-auth
- Student self-registration (the 4-step funnel).
- New-family vs. existing-family path (existing path searches and pre-fills guardian data).
- Login; role selection (family vs. staff).

### 2.2 Admin portal
- **Dashboard** — KPIs, charts (`initCharts`), next-actions.
- **Calendar** — day / week / month / roster views (`setView`), event detail, mark attendance from calendar, add lesson to an open slot.
- **Students** — list (filter/search), student detail (admin view richer than teacher view), add student.
- **Families** — list, family detail, contact info, per-family transaction ledger, send invoice, auto-invoice toggle.
- **Staff** — list, add staff, staff detail with tabs (Contact / Payroll / Availability / Students / **Privileges**), edit contact, edit payroll, edit privileges, assign/remove students to teachers.
- **Lesson notes** — list and per-student notes; new note.
- **Attendance** — quick-mark today, mark all present, attendance report modal/export.
- **Notifications** — automated notification rules (edit rule).
- **Enrollment** — enrollment management.
- **Billing** — invoices, create invoice, invoice modal, line items, due dates, auto-invoice, download PDF.
- **Payroll & expenses** — payroll page, payroll options/types (hourly / percentage / salary), makeup-pay policy, expenses, mileage, rate-change requests.
- **AI summaries** — AI-generated lesson summaries (to be built on our own transcription/data layer).
- **Resources** — add/edit/delete shared learning resources/files.
- **Messaging** — internal threads, compose, select/filter messages, mailto bridge.
- **Approvals** — review pending registrations; approve (creates student/family) or deny.
- **Waitlist / leads** — add lead, list.
- **Reports** — generated report views (`buildReportsPage`).
- **Settings** — studio + teacher-privilege global defaults; payment/auto-invoice settings.

### 2.3 Teacher portal
- Dashboard, Calendar, **My students** (scoped to assigned students), Lesson notes, **LMS & repertoire**, Resources, Messaging.
- All actions gated by the teacher's privilege object (e.g., can/can't view family address/email, manage other teachers' lessons, add invoices/expenses, edit resources, create reports, view payroll).

### 2.4 Family portal
- Dashboard (next lesson hero, quick stats), Lessons (calendar), Lesson notes (read), **Practice & repertoire** (add piece), Resources, Billing (view balance/invoices, pay/transactions), Messaging, Profile.

### 2.5 Cross-cutting workflows
- **Lesson lifecycle:** schedule → reminder (email/SMS) → occur → attendance → optional makeup credit → lesson note → (optional) AI summary → billing line item.
- **Makeup credits:** students carry `makeupTotal / makeupAvailable / makeupBooked`; rescheduling and makeup scheduling consume/issue credits; payroll has a makeup-pay policy (`issued` vs `used`).
- **Auto-invoicing:** per-family flag drives periodic invoice generation from completed lessons.
- **Registration approval:** public submission → pending queue → admin approve (provisions family + student + enrollment) or deny (with reason).

---

## 3. Identified missing / implicit business logic

These are gaps the prototype hides behind mock data. We must define them before/while building. **None are assumed silently — each is flagged for confirmation during its phase.**

1. **Authentication & identity.** No real users, sessions, passwords, verification, or reset. A `User` is distinct from the domain roles (a person may be a guardian *and* a teacher). Needs an identity model separate from `Student`/`StaffMember`/`Family`.
2. **Tenant boundary.** "Studio" is implicit. We must introduce `Organization` and bind users via memberships.
3. **Enrollment as an entity.** The UI conflates "student" with "what they're enrolled in." Real model: a `Student` has many `Enrollments` (instrument + lesson type + teacher + schedule + rate), each with its own lifecycle (trial/active/paused/withdrawn).
4. **Scheduling rules.** *Resolved (§0.2/§0.3/§0.4):* **per-term/block** scheduling, teacher availability windows, blocked time, **room conflicts across 5 rooms**, reschedule request→approval flow, and the < 24h cancellation window are all defined. Remaining detail: exact term length/calendar — see §14.
5. **Billing math.** *Resolved (§0.2/§0.4):* **per-lesson charges**, cancellation policy table, **no VAT**, and **both invoice modes** (monthly statement / per-lesson). Remaining: payment terms / late-fee policy — see §14.
6. **Payroll math.** *Resolved (§0.1/§0.4):* **hourly** on **actual elapsed lesson time** (prep/admin excluded), under Teachers & Staff. Paid for delivered lessons **and** < 24h student cancellations (§0.2, at scheduled duration), not for ≥ 24h or teacher-initiated cancellations.
7. **Privilege semantics.** The privilege object exists but its *enforcement points* don't. Each flag must map to concrete backend permission checks.
8. **Notification/automation rules.** "All notifications sent automatically" — we must define the trigger catalog (events), conditions, and templates for the in-house workflow engine.
9. **AI pipeline.** *Resolved (§0.4/§7.1):* **optional & teacher-triggered**, fed by an attached **audio/video** recording, **stub providers** at launch behind transcription/assessment/summary interfaces for a later Whisper/LLM swap. Full schemas, API contracts, queues, and storage in §7.1.
10. **Idempotency & dedup.** Registration double-submit, duplicate students per family, duplicate invoices, duplicate jobs — no protection today.
11. **Data retention / consent / PII (UK GDPR).** *Resolved (§0.5):* media kept live 1 month then archived (admin/teacher break-glass), student download before archival, ex-student records purged after 30 days; consent required before recording enters the pipeline; UK/EU residency; audit logging on break-glass + purge. Visibility rules per the privilege model (§8).

---

## 4. Target architecture

### 4.1 Stack (as required)
- **Frontend:** Next.js (App Router), React Server Components where useful, TypeScript, server-side session handling via httpOnly cookies. Locale **en-GB**, timezone **Europe/London**, currency **GBP**.
- **Backend:** NestJS (TypeScript) — clean layered modules.
- **DB:** Postgres. Migrations via **Drizzle** (confirmed) — explicit SQL + typed queries.
- **Cache/Queue:** Redis + BullMQ (jobs) + Redis for caching and rate-limit counters.
- **Storage:** S3-compatible (AWS S3 / Cloudflare R2) behind an internal `FileStorage` port; signed URLs.
- **Hosting (UK/EU residency — confirmed):** Vercel (frontend, London/EU region), Fly.io **lhr (London)** for API + workers + Redis, Postgres in a **UK/EU** region (e.g. Neon `eu` / Supabase `eu-west`), S3 bucket in `eu-west-2` (London). Self-hosted AI runs in the same UK/EU region.

### 4.2 Single source of truth
- **All** business logic, RBAC, scope checks, and validation live in the NestJS backend.
- The Next.js app calls the backend API only. It renders UI and does *optimistic* UX, never security. Any value the client sends (role, ownership, prices) is re-derived/verified server-side.

### 4.3 Layered backend (per module)
```
HTTP → Controller (routing, DTO binding)
     → Guard/Middleware (authN, RBAC, scope, rate limit, idempotency)
     → Service (business logic, transactions)
     → Repository (DB access via Drizzle)
     ← Validation (Zod/class-validator DTO schemas at the edge)
```
Cross-cutting: request-id middleware, structured logger, error filter, tenant-context interceptor (resolves `organization_id` from the session and pins it for the request).

### 4.4 Module map (NestJS)
`auth`, `organizations`, `users/memberships`, `families`, `students`, `staff`, `enrollments`, `scheduling` (lessons/availability/calendar), `attendance`, `billing` (invoices/ledger/payments), `payroll`, `notes`, `resources`, `messaging`, `notifications` (workflow engine), `ai` (transcription/summaries), `registration` (public funnel + approvals), `leads/waitlist`, `reports`, `files`, `webhooks`/`integrations` (calendar, meeting links, messaging delivery), `health`.

### 4.5 Ports & adapters (the only external seams)
- `EmailPort` → **`ResendAdapter`** (confirmed). In-house routing/templating; adapter only delivers.
- `SmsPort` → **`StubSmsAdapter`** (placeholder — logs payload). Native-code vs. vendor (e.g. Twilio/Vonage) **undecided**; the port keeps the rest of the system agnostic until you choose.
- `CalendarPort` → `GoogleCalendarAdapter`, `OutlookAdapter` — **one-way push only**, connecting **each teacher's own** Google/Outlook via per-teacher OAuth (confirmed). No inbound sync, no shared studio calendar.
- `MeetingLinkPort` → `ZoomAdapter` / `GoogleMeetAdapter` (generate join links).
- `PaymentProvider` → `ManualProvider` (now), `StripeProvider` (later).
- `FileStoragePort` → `S3Adapter` (UK/EU; active + restricted-archive tiers, §7.1/§0.5).
- AI = three ports — `TranscriptionProvider`, `AssessmentProvider`, `SummaryProvider` (§7.1). **Stub adapters at launch**; Whisper-class transcription + production LLM plug in by env config, no refactor.

---

## 5. Page inventory (artifact #1)

| # | Page | Portal(s) | Primary entities | Notes |
|---|---|---|---|---|
| P1 | Registration funnel | Public | Registration, Family, Student | 4 steps + success |
| P2 | Login | Public | User, Session | + password reset / verify |
| P3 | Dashboard | Admin, Teacher, Family | KPIs, Lesson, Invoice | role-specific content |
| P4 | Calendar | Admin, Teacher, Family | Lesson, Availability | day/week/month/roster |
| P5 | Students list | Admin, Teacher | Student, Enrollment | teacher = assigned only |
| P6 | Student detail | Admin, Teacher | Student, Note, Attendance, Enrollment | admin view richer |
| P7 | Families list | Admin | Family | |
| P8 | Family detail | Admin | Family, Ledger, Invoice | + transactions |
| P9 | Staff list | Admin | StaffMember | |
| P10 | Staff detail | Admin | StaffMember, Payroll, Privileges, Availability | tabbed |
| P11 | Lesson notes | Admin, Teacher, Family | Note | family read-only |
| P12 | Attendance | Admin | Attendance, Lesson | quick-mark/report |
| P13 | Notifications | Admin | NotificationRule | automation rules |
| P14 | Enrollment | Admin | Enrollment | |
| P15 | Billing | Admin, Family | Invoice, Ledger, Payment | family = own only |
| P16 | Payroll & expenses | Admin | Payroll, Expense, Mileage, RateChange | **lives under "Teachers & Staff"**, hourly only |
| P17 | AI summaries | Admin, (Teacher) | Recording, Transcript, Summary | in-house pipeline |
| P18 | Resources | Admin, Teacher, Family | Resource, File | CRUD by privilege |
| P19 | Messaging | Admin, Teacher, Family | Thread, Message | |
| P20 | Approvals | Admin | Registration | approve/deny |
| P21 | Waitlist / leads | Admin | Lead | |
| P22 | Reports | Admin | (aggregates) | |
| P23 | Settings | Admin | Organization, PrivilegeDefaults, PaymentSettings | |
| P24 | LMS & repertoire | Teacher | Repertoire, Assignment | |
| P25 | Practice & repertoire | Family | Repertoire, PracticeLog | |
| P26 | Profile | Family, (all) | User, Family | |

### 5.1 Component architecture (artifact #3)
- **Layout shell:** `AppShell` (sidebar from a server-fetched `NAV` derived from the user's permissions, top bar, portal switcher for multi-role users).
- **Primitives:** `DataTable`, `FilterBar`, `Modal` (replaces the prototype's `openMo/closeMo`), `Drawer`, `Toast`, `Chip/InstrumentPicker`, `StepperForm` (registration), `Calendar` (day/week/month/roster), `LedgerTable`, `PrivilegeMatrixEditor`, `KpiCard`, `Chart` wrappers.
- **Feature modules** mirror backend modules; each owns its data-fetching hooks (server actions / RSC fetch) and page components.
- **No client-side authority:** the sidebar/nav and any "can I see this button" decisions are driven by a server-provided `permissions` set; the server still re-checks on every call.

---

## 6. Route map (artifact #2)

### 6.1 Frontend (Next.js App Router)
```
/                      → marketing/redirect
/register              → P1 public funnel
/login  /verify  /reset-password
/app                   → authed shell (redirects by primary role)
/app/dashboard
/app/calendar
/app/students          /app/students/[id]
/app/families          /app/families/[id]
/app/staff             /app/staff/[id]
/app/staff/payroll     (payroll lives under Teachers & Staff)
/app/notes             /app/notes/[studentId]
/app/attendance
/app/notifications
/app/enrollment
/app/billing           /app/billing/invoices/[id]
/app/ai
/app/resources
/app/messaging         /app/messaging/[threadId]
/app/approvals
/app/leads
/app/reports
/app/settings
/app/lms               (teacher)   /app/practice (family)
/app/profile
```
Server middleware guards `/app/**`: no session → `/login`; route-level permission check before render; data still re-authorized in the API.

### 6.2 Backend API (REST, versioned `/api/v1`, all org-scoped)
Representative endpoints (full OpenAPI spec to be generated in Phase 1):

```
Auth:        POST /auth/register-account  /auth/login  /auth/logout
             POST /auth/refresh  /auth/verify-email  /auth/request-reset  /auth/reset
Public reg:  POST /public/registrations            (Idempotency-Key)
             GET  /registrations (admin)  POST /registrations/:id/approve|deny
Students:    GET/POST /students   GET/PATCH/DELETE /students/:id
Enrollments: GET/POST /students/:id/enrollments  PATCH /enrollments/:id
Families:    GET/POST /families   GET/PATCH /families/:id  GET /families/:id/ledger
Staff:       GET/POST /staff  GET/PATCH /staff/:id  PATCH /staff/:id/privileges
             POST /staff/:id/assignments  DELETE /staff/:id/assignments/:sid
Scheduling:  GET /lessons  POST /lessons (Idem)  PATCH /lessons/:id
             POST /lessons/:id/cancel       (applies §0.2 charge/pay/credit policy in one txn)
             POST /lessons/:id/reschedule   (admin/teacher — direct, no approval)
             POST /reschedule-requests (Idem, student/guardian)  GET /reschedule-requests
             POST /reschedule-requests/:id/approve|deny   (admin or assigned teacher)
             GET/POST /availability  POST /blocked-time   GET /rooms
Attendance:  POST /lessons/:id/attendance  POST /attendance/bulk
Billing:     GET/POST /invoices (Idem)  GET /invoices/:id  POST /invoices/:id/send
             POST /payments (Idem)  GET /invoices/:id/pdf
Payroll:     GET /staff/payroll  POST /expenses  POST /rate-change-requests  PATCH .../:id
Notes:       GET/POST /notes  PATCH /notes/:id
Resources:   GET/POST /resources  DELETE /resources/:id   (file upload → signed URL)
Messaging:   GET/POST /threads  POST /threads/:id/messages
Notifications: GET/POST/PATCH /notification-rules
AI:          POST /lessons/:id/recordings (Idem, audio/video)  POST /lessons/:id/summary (manual trigger)  GET /lessons/:id/summary
Leads:       GET/POST /leads
Reports:     GET /reports/:type
Files:       POST /files/sign-upload  GET /files/:id/sign-download
Health:      GET /health  /health/ready  /health/live
```
Conventions: cursor pagination, `If-Match`/ETag on mutable resources, `Idempotency-Key` on all create/side-effect POSTs, consistent error envelope `{error:{code,message,requestId}}`.

---

## 7. Database schema (artifact #5)

Postgres, UUID PKs, `created_at/updated_at`, soft-delete (`deleted_at`) where audited, every domain row has `organization_id`. **Ownership scope is intentional per table** (not uniform).

| Table | Scope | Key columns / relationships |
|---|---|---|
| `organizations` | global | id, name, slug, settings(jsonb), timezone(`Europe/London`), currency(`GBP`), country(`GB`) |
| `users` | global | id, email (unique), password_hash, email_verified_at, status |
| `memberships` | org | user_id, organization_id, **base_role** (system_admin/admin/manager/receptionist/technician/teacher/guardian/student), status; unique(user_id, org_id) |
| `sessions` / `refresh_tokens` | global | user_id, token_hash, rotated_from, expires_at, revoked_at |
| `families` | org | id, name, primary_guardian_user_id, address, phone, email, auto_invoice(bool), **invoice_mode(monthly_statement \| per_lesson)** (defaults from org setting), balance_cached |
| `terms` | org | id, name, starts_on, ends_on, week_count(**12**), status(planned/active/closed) — lessons/enrollments are scoped to a term/block |
| `guardians` | org | family_id, user_id, relationship (a user↔family link; a family may have several guardians) |
| `students` | org | id, family_id, first/last, dob, email(nullable), student_user_id(nullable — **created iff student has an email**; otherwise access is via the family's guardian, no age threshold), status(trial/active/paused/withdrawn) |
| `staff_members` | org | id, user_id, title, instruments(text[]), default_duration, payroll_type(**hourly at launch**), hourly_rate, status |
| `staff_privileges` | org | staff_id, privileges(jsonb mirroring prototype object) **or** normalized `permissions` join (see §8) |
| `teacher_assignments` | org | staff_id, student_id (many-to-many), role(primary/secondary) |
| `enrollments` | org | id, student_id, term_id, instrument, lesson_type(private/group), teacher_id, rate, schedule_rule(weekday+time within the term), **auto_renew(bool, default true)**, status |
| `rooms` | org | id, name, capacity; seeded with **5 rooms** |
| `lessons` | org | id, enrollment_id, term_id, teacher_id, student_id, room_id, starts_at, duration(scheduled), **actual_started_at, actual_ended_at (→ elapsed minutes for payroll)**, status(scheduled/completed/cancelled_student_late/cancelled_student_early/cancelled_teacher/makeup), cancelled_at, meeting_link, external_calendar_id |
| `reschedule_requests` | org | lesson_id, requested_by(user_id), proposed_starts_at, proposed_room_id?, status(pending/approved/denied), decided_by, decided_at, reason |
| `availability` | org | staff_id, weekday, start, end |
| `blocked_time` | org | staff_id, starts_at, ends_at, reason |
| `attendance` | org | lesson_id (unique), status(present/absent/late/excused), marked_by, marked_at |
| `makeup_credits` | org | student_id, source_lesson_id, status(available/booked/used) — **no expiry** |
| `invoices` | org | id, family_id, mode(monthly_statement/per_lesson), term_id?, number(unique per org), period_start/end, issued_on, due_date(**issued_on + 7 days**), status(draft/sent/paid/void), total, tax(**always 0 — no VAT**), notes |
| `invoice_line_items` | org | invoice_id, lesson_id?, description, amount |
| `ledger_entries` | org | family_id, type(charge/payment/credit/adjustment), amount, balance_after, invoice_id?, occurred_at |
| `payments` | org | family_id, invoice_id?, method(bank_transfer/cash/card), amount(pence), provider_ref?, idempotency_key |
| `payroll_runs` / `payroll_items` | org | staff_id, period, hours(**actual elapsed lesson time; prep/admin excluded**), hourly_rate, gross (includes < 24h student cancellations paid at scheduled duration per §0.2) |
| `expenses` | org | staff_id?, category, amount, mileage_km?, date, receipt_file_id? |
| `rate_change_requests` | org | staff_id, current_rate, requested_rate, status(pending/approved/denied), decided_by |
| `notes` | org | student_id, lesson_id?, author_id, body, attachments, visibility(internal/family) |
| `recordings` | org | lesson_id, student_id, file_id, media_type(audio/video), uploaded_by, consent(bool), status, **retain_until, archived_at, archive_file_key** — optional; only when a teacher attaches one (full schema §7.1) |
| `transcripts` | org | recording_id, provider, text, language, segments(jsonb), model_meta, **retain_until, archived_at** (§7.1) |
| `assessments` | org | lesson_id, transcript_id?, rubric(jsonb), scores(jsonb), provider, **retain_until, archived_at** — structured AI evaluation, separate from prose summary (§7.1) |
| `lesson_summaries` | org | lesson_id, recording_id, transcript_id?, assessment_id?, summary, generated_by(teacher), trigger(manual), provider, **retain_until, archived_at** — created only on the optional "AI summary" button (§7.1) |
| `ai_jobs` | org | lesson_id, recording_id, kind(transcribe/assess/summarize), provider, status, attempts, error, idempotency_key — tracks the pipeline (§7.1) |
| `resources` | org | id, title, type, file_id?, url?, scope(studio/teacher/family/student), owner_id |
| `threads` / `messages` | org | participants, subject; message: thread_id, sender_id, body, read_by(jsonb) |
| `notification_rules` | org | trigger_event, conditions(jsonb), channels(email/sms), template_id, enabled |
| `notification_log` | org | rule_id?, user_id, channel, payload_hash, status, sent_at |
| `registrations` | org | payload(jsonb), status(pending/approved/denied), submitted_at, decided_by, idempotency_key |
| `leads` | org | name, contact, instrument_interest, source, status, notes |
| `files` | org | id, key, mime, size, checksum, owner_id, scope, virus_scan_status |
| `audit_log` | org | actor_id, action, entity, entity_id, before/after(jsonb), request_id, ip |
| `idempotency_keys` | org | key, endpoint, request_hash, response_snapshot, expires_at |
| `outbox` | org | aggregate, event_type, payload, published_at (transactional outbox for jobs) |

**Indexes** (initial): `students(org_id, status)`, `lessons(org_id, teacher_id, starts_at)`, `lessons(org_id, student_id, starts_at)`, `lessons(org_id, room_id, starts_at)` (room-conflict checks), `ledger_entries(org_id, family_id, occurred_at)`, `memberships(user_id)`, `teacher_assignments(student_id)`, `invoices(org_id, family_id, status)`, `reschedule_requests(org_id, status)`, unique `invoices(org_id, number)`, unique `idempotency_keys(org_id, key)`, partial index on `lessons(status='scheduled')` for reminder jobs.

**Integrity:** FKs everywhere, `CHECK` on enums (or native enum types), unique constraints to dedup (`registrations` idempotency_key, one `attendance` per lesson, one primary teacher per student). **No double-booking** enforced on `lessons` for both teacher and room over overlapping time (exclusion constraint / app-level check in transaction). Money stored as integer **pence (GBP)**. All multi-step writes wrapped in transactions (e.g., approve-registration creates family+student+enrollment+ledger atomically; reschedule moves lesson + adjusts makeup credit atomically; a `< 24h` student cancellation charges the family + records teacher pay + closes the lesson in one transaction).

---

## 7.1 AI & media domain (detailed)

The AI feature **ships as a stub** but every stage sits behind a provider interface, so a Whisper-class transcriber and a production LLM can be swapped in by config alone — no schema, API, or queue changes.

### Provider interfaces (ports)
```ts
interface TranscriptionProvider {            // StubTranscriber → WhisperProvider later
  transcribe(input: { fileKey: string; mediaType: 'audio'|'video'; language?: string })
    : Promise<{ text: string; segments: Segment[]; language: string; modelMeta: object }>;
}
interface AssessmentProvider {                // StubAssessor → LLMProvider later
  assess(input: { transcript: string; rubric: Rubric; context: LessonContext })
    : Promise<{ scores: Record<string, number>; rubric: Rubric; notes: string }>;
}
interface SummaryProvider {                   // StubSummarizer → LLMProvider later
  summarize(input: { transcript: string; assessment?: object; context: LessonContext })
    : Promise<{ summary: string; modelMeta: object }>;
}
```
Selected via `AI_TRANSCRIPTION_PROVIDER` / `AI_ASSESSMENT_PROVIDER` / `AI_SUMMARY_PROVIDER` env. Stubs return deterministic placeholder output and mark `provider:'stub'` so stub-generated rows are identifiable and re-runnable once a real provider is configured.

### Schemas (DDL sketch — Drizzle)
- `recordings(id, org_id, lesson_id, student_id, file_id, media_type['audio'|'video'], duration_seconds, consent bool not null, consent_by, consent_at, uploaded_by, status['uploaded'|'processing'|'ready'|'archived'|'deleted'], retain_until timestamptz, archived_at, archive_file_key, created_at)`
- `transcripts(id, org_id, recording_id fk, provider, language, text, segments jsonb, model_meta jsonb, status, retain_until, archived_at, created_at)`
- `assessments(id, org_id, lesson_id, transcript_id fk, provider, rubric jsonb, scores jsonb, notes, retain_until, archived_at, created_at)`
- `lesson_summaries(id, org_id, lesson_id, recording_id, transcript_id, assessment_id, provider, summary text, model_meta jsonb, generated_by, trigger['manual'], retain_until, archived_at, created_at)`
- `ai_jobs(id, org_id, lesson_id, recording_id, kind['transcribe'|'assess'|'summarize'], provider, status['queued'|'running'|'succeeded'|'failed'], attempts, last_error, idempotency_key unique, created_at, updated_at)`

`retain_until` defaults to `created_at + 1 month` (§0.5). Indexes: `recordings(org_id, retain_until)` and `recordings(org_id, status)` to drive the archival/purge sweeps; unique `ai_jobs(idempotency_key)`.

### API contracts
```
POST /lessons/:id/recordings            (Idempotency-Key; multipart OR sign-upload handshake)
   → { recordingId, uploadUrl?, status }            requires teacher scope + consent flag
POST /lessons/:id/recordings/:rid/summary           (manual trigger; enqueues pipeline)
   → 202 { jobId, status:'queued' }
GET  /lessons/:id/ai                                 → { recording, transcript, assessment, summary, jobStatus }
GET  /recordings/:rid/download                       → signed URL (student/guardian allowed pre-archival; admin/teacher always)
GET  /transcripts/:tid/download  GET /summaries/:sid/download   → signed URLs (same rule)
DELETE /recordings/:rid                              → soft-delete + storage removal (privileged)
```
All responses scoped by `org_id` + ownership. Download is permitted to the student/guardian **only while `archived_at IS NULL`**; after archival only admin/teacher (break-glass, audited).

### Job queues (BullMQ)
`ai.transcribe` → `ai.assess` → `ai.summarize`, chained; each idempotent (keyed on recording_id+kind), retry with exponential backoff, dead-letter queue, concurrency-limited (protect the self-hosted GPU/CPU later). Plus two repeatable maintenance jobs: `media.archive` (moves rows past `retain_until` to the restricted archive tier, sets `archived_at`/`archive_file_key`, flips bucket lifecycle/class) and `account.purge` (hard-deletes ex-student data 30 days after departure, §0.5). Both emit `audit_log` entries.

### Storage
Two logical buckets/prefixes in the UK/EU region behind `FileStoragePort`: **active** (`s3://…/active/org/<id>/recordings/…`, private, short-lived signed URLs, lifecycle → archive class at 1 month) and **archive** (restricted, no student access, retrieval only via admin/teacher break-glass). Uploads via pre-signed PUT; AES-256 at rest; randomized keys; MIME + magic-byte + size validation before processing; antivirus/scan status gate before any download.

---

## 8. RBAC model & matrix (artifact #6)

### 8.1 Model
Three layers, all enforced **backend-only**:
1. **Base role** (on `membership`): `system_admin`, `admin`, `manager`, `receptionist`, `technician`, `teacher`, `guardian`, `student`.
2. **Fine-grained privileges** (for staff) — directly from the prototype's privilege object, promoted to first-class permissions:
   - manageSelf: `payments.record`, `lessons.edit_own`, `payroll.view_own`, `mileage.manage`
   - manageOtherTeachers: `teachers.view_contact`, `teachers.manage_students_lessons`, `teachers.view_lessons`
   - manageStudentsParents: `family.view_address_phone`, `family.view_email`, `attachments.view_download`
   - other: `invoices.manage`, `expenses.manage`, `resources.manage`, `website.edit`, `reports.manage`
   - `administrator: true` ⇒ superset within the org.
3. **Scope checks** (ownership) — even with a permission, the row must be in the user's org **and** within reach: a teacher only touches assigned students; a guardian only their family's data; a student only their own.

Enforcement = `@Roles()` + `@RequirePermission()` guards + a mandatory `scopeCheck(resource, user)` in the service layer. Default-deny.

### 8.2 Matrix (representative; full matrix generated from privilege catalog in Phase 1)

| Capability | system_admin | admin | manager | receptionist | technician | teacher (default) | guardian | student |
|---|---|---|---|---|---|---|---|---|
| Manage organizations/settings | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| View all students | ✅ | ✅ | ✅ | ✅ | ❌ | assigned only | own children | self |
| Edit student/enrollment | ✅ | ✅ | ✅ | ✅ | ❌ | privilege-gated | ❌ | ❌ |
| View family address/phone | ✅ | ✅ | ✅ | ✅ | ❌ | priv `family.view_address_phone` | own | own |
| Schedule/edit/reschedule lessons (direct) | ✅ | ✅ | ✅ | ✅ | ❌ | own (+others if priv) | ❌ | ❌ |
| Request a reschedule | ✅ | ✅ | ✅ | ✅ | ❌ | own | ✅ own children | ✅ self |
| Approve/deny reschedule request | ✅ | ✅ | ✅ | ✅ | ❌ | assigned student's request | ❌ | ❌ |
| Mark attendance | ✅ | ✅ | ✅ | ✅ | ❌ | own lessons | ❌ | ❌ |
| Create/send invoices | ✅ | ✅ | ✅ | ✅ | ❌ | priv `invoices.manage` | ❌ | ❌ |
| View invoices/balance | ✅ | ✅ | ✅ | ✅ | ❌ | own payroll only | own family | ❌ |
| Run/view payroll | ✅ | ✅ | ✅ | ❌ | ❌ | own (`payroll.view_own`) | ❌ | ❌ |
| Manage staff & privileges | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manage resources | ✅ | ✅ | ✅ | ❌ | priv | priv `resources.manage` | ❌ | ❌ |
| Approve registrations | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| View AI summary | ✅ | ✅ | ✅ | ❌ | ❌ | own students | own children | self |
| System/tenant admin (cross-org) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

(✅ = full; "own/assigned/own family/self" = scoped; "priv" = depends on the staff privilege flag.)

---

## 9. Key user flows (artifact #7)

1. **Public registration → approval** — Guest submits funnel (Idempotency-Key prevents double-submit; dedup against existing family by email). Creates a `registration` (pending). Workflow engine emits "registration.received" → confirmation email. Admin reviews in Approvals → **approve** runs one transaction: create/attach family → create student → create enrollments from selected instruments → seed ledger → emit "student.approved" → welcome email + (optional) calendar invite. **Deny** records reason → emits "registration.denied" email.
2. **Lesson reminders (in-house workflow engine)** — A scheduled scanner (BullMQ repeatable job) finds lessons starting in 24h (email via `EmailPort`/Resend) / 2h (SMS via `SmsPort`, currently the stub adapter), checks per-family preferences, enqueues delivery jobs. Jobs are idempotent (dedup key = lesson_id+channel+window) and retry with backoff. When the SMS provider is chosen, only the adapter changes.
3. **Attendance → billing** — Teacher marks attendance (scope: own lesson). On "completed," a domain event creates a **per-lesson** ledger charge. Invoice generation depends on the family's `invoice_mode`: **per_lesson** ⇒ an invoice per charge; **monthly_statement** ⇒ a scheduled job aggregates the period's charges into one statement. No VAT applied.
4. **Cancellation (§0.2)** — One transaction applies the policy by who/when: **student < 24h** → charge family + record teacher pay + close lesson, **no credit**; **student ≥ 24h** → no charge, no pay, **issue makeup credit**; **teacher cancels** → no charge, no pay, **issue makeup credit**. The credit (`makeup_credits`, never expires) is emitted via the outbox so downstream jobs (calendar removal, notification) fire only on commit.
5. **Reschedule (§0.3)** — *Student/guardian path:* create a `reschedule_request` **at least 24h before the lesson** (requests inside 24h are rejected → cancellation policy applies; no cap on request count), constrained to the assigned teacher's free slots; it stays **pending** until an **admin or the assigned teacher approves** (lesson moved in one transaction, validated against teacher **and room** availability) or **denies** (lesson unchanged, requester notified). *Admin/teacher path:* direct reschedule, same conflict validation, no 24h limit, no approval step. Calendar push via one-way `CalendarPort` to the teacher's own Google/Outlook.
6. **Term roll-over (auto-enrol)** — Before a term ends, a job creates next-term `enrollments` + `lessons` for every enrolment with `auto_renew=true` (same slot/teacher/room), skipping any the parent/student has stopped. Conflicts surface to admin for resolution.
7. **AI summary (optional, teacher-triggered, stubbed)** — A teacher optionally attaches an **audio or video** recording (signed-URL upload + consent) and presses **"AI summary"**, enqueuing `ai.transcribe → ai.assess → ai.summarize` (§7.1). At launch these run **stub providers**; a Whisper-class transcriber + production LLM swap in via env with no schema/API/queue change. Outputs (transcript, assessment, summary) are downloadable by the student/guardian until archival at 1 month, then admin/teacher-only.
8. **Retention sweeps (§0.5)** — `media.archive` moves recordings/transcripts/assessments/summaries past `retain_until` (1 month) into restricted archive storage; `account.purge` hard-deletes ex-student data 30 days after departure. Both audited.
9. **Auth lifecycle** — Register account → email verification (Resend) → login (Argon2id password check) → short-lived access JWT + rotating refresh token (httpOnly cookie) → refresh rotation with reuse detection → password reset via single-use signed token. A student account exists only when the student has an email; otherwise the guardian's account is the access point.

---

## 10. Security model

- **AuthN:** Argon2id hashing; email verification required; access token (~15 min) + refresh token with rotation + reuse detection; sessions revocable; CSRF protection (double-submit / SameSite) for cookie auth.
- **AuthZ:** default-deny; role + permission + scope at the service layer; **IDOR** prevented by always filtering on `organization_id` + ownership, never trusting client-supplied IDs/roles/prices.
- **Input validation:** Zod/class-validator DTOs on body, params, query; reject unknown fields; file uploads validated by MIME + magic-byte sniff + size cap + virus-scan status before access.
- **OWASP:** parameterized queries only (no string SQL) → SQLi; output encoding + CSP → XSS; SameSite + token → CSRF; allowlist + no raw user URLs in server fetch → SSRF; org+ownership filters → IDOR/broken access control; rate limiting + lockout → auth bypass/brute force.
- **Files:** randomized keys, signed time-limited URLs, ownership check on every sign request, private bucket (UK/EU region).
- **Secrets/logging:** structured logs with request-id, user-id, route, latency, error; **never** log secrets, passwords, tokens, full PII; audit_log for sensitive mutations.
- **UK GDPR / ICO:** UK/EU data residency for all stores; recorded lawful basis + guardian consent for minors; consent flag required before any lesson recording enters the AI pipeline; data-subject access & erasure supported (soft-delete + hard-purge job); defined retention windows (recordings/transcripts shortest) — values to confirm in §14.

### Rate limiting
| Class | Limit (per principal/IP) |
|---|---|
| Auth (login/reset/verify) | strict — e.g. 5/min + lockout/backoff |
| Public registration | strict — e.g. 3/min/IP + Idempotency-Key |
| Write operations | moderate — e.g. 30/min |
| General reads | standard — e.g. 120/min |
| File uploads | strict — e.g. 10/hour |

### Idempotency, atomicity, dedup
- `Idempotency-Key` header on payments, registration submit, all creates with side effects; stored response replayed on retry.
- Transactions wrap every multi-step write; transactional **outbox** publishes domain events so jobs never fire on rolled-back state.
- DB constraints (unique keys) + service-level checks dedup students/invoices/jobs.

---

## 11. Caching, jobs, observability, reliability

- **Cache:** Redis for hot reads (dashboard aggregates, nav/permissions, public-ish data). **Keys always include `org_id` (+ `user_id`/role where user-specific)** to prevent cross-tenant leakage. Explicit invalidation on writes; short TTLs as backstop.
- **Background jobs (BullMQ):** email/SMS delivery, reminder scanning, invoice generation (per-lesson + monthly statement), **term roll-over / auto-enrol**, payroll runs, report generation, **AI pipeline** (`ai.transcribe→assess→summarize`), **retention sweeps** (`media.archive`, `account.purge`), calendar push, file post-processing. All **retry-safe + idempotent**, exponential backoff, dead-letter queue, repeatable schedulers.
- **Observability:** structured JSON logs (request-id propagated client→API→jobs); error tracking (Sentry) for frontend + backend + DB errors; metrics; `/health`, `/health/ready`, `/health/live`.
- **Reliability:** retries w/ backoff; circuit breakers around `EmailPort`/`SmsPort`/`CalendarPort`/`MeetingLinkPort`/`AiPort`; graceful degradation (e.g., reminders queue and retry if a provider is down; SMS jobs simply hit the stub adapter until a provider is chosen; app stays read-usable if cache down).

---

## 12. CI/CD & testing

- **Branches:** `develop` → staging, `main` → production; PRs gated.
- **Pipeline (per PR):** install → typecheck → lint → unit tests → integration tests (ephemeral Postgres + Redis) → **migration check** (migrate up/down on shadow DB; drift detection) → build → preview deploy. Merge blocked on green.
- **Deploy:** frontend → Vercel; API + workers → Fly.io; migrations run as a gated release step (expand/contract pattern, no destructive change without two-phase migration).
- **Tests:** unit (services, billing/payroll math, RBAC resolver, validators); integration (API + DB per module, incl. transaction rollback); **security tests** (authn bypass attempts, RBAC matrix per role, scope/IDOR, rate-limit, idempotency replay). Seed/factory utilities; no mock data in delivered phases.

---

## 13. Phased migration plan (artifact #8)

Each phase is independently deployable, tested, migration-complete, and never breaks prior functionality.

**Phase 0 — Foundations.** Monorepo (pnpm/turbo), Next.js + NestJS skeletons, Postgres + Redis, **Drizzle** migration tooling, CI/CD pipeline, health endpoints, logging + error tracking, ports/adapters scaffolding (Resend email adapter + **stub SMS adapter** + stub calendar/AI). UK/EU hosting regions wired. *Deployable empty app + green pipeline.*

**Phase 1 — Identity & tenancy.** `organizations`, `users`, `memberships`, sessions/refresh rotation, email verification, password reset, login/logout, AppShell with server-driven nav, RBAC guards + scope framework, audit log, rate limiting on auth. Seed the single org. *Deployable: real login + role-aware empty portals.*

**Phase 2 — Core domain (read/write).** Families, students, guardians, staff, teacher assignments, enrollments. Students/Families/Staff list+detail pages wired to real APIs, privilege editor. Migrate prototype's seeded data shape into real factories (dev only). *Deployable: manage people for real.*

**Phase 3 — Scheduling & attendance.** **12-week terms** + **auto-enrol roll-over** job, lessons, **5 rooms** + double-booking prevention (teacher & room), availability, blocked time, calendar (day/week/month/roster), direct reschedule (admin/teacher) + **reschedule-request approval flow** (student/guardian, 24h notice, no cap), makeup credits (no expiry), attendance + actual-time capture, reports, one-way per-teacher `CalendarPort` push + `MeetingLinkPort`. *Deployable: run the schedule.*

**Phase 4 — Billing & payroll.** Per-lesson charges + cancellation policy engine (§0.2), invoices, ledger, payments (ManualProvider), invoice PDF, auto-invoice job, **hourly payroll runs under Teachers & Staff** (incl. paid late-cancellations), expenses, mileage, rate-change requests, family billing view. *Deployable: money tracked end-to-end (no card processing yet).*

**Phase 5 — Communication & automation.** In-house workflow/notification engine (trigger catalog, rules, templates), `EmailPort` (Resend) delivery + `SmsPort` (stub), reminder jobs (24h email / 2h SMS), messaging threads, notification log. Public registration funnel + approval workflow wired live. *Deployable: reminders + registration + messaging.*

**Phase 6 — Resources, AI, reports.** File storage (active + restricted-archive tiers, signed URLs, scanning), resources CRUD, LMS/repertoire/practice, optional audio/video recording upload + teacher-triggered AI pipeline behind **stub provider interfaces** (§7.1; Whisper/LLM later by config), subject-download endpoints, **retention sweeps** (`media.archive` at 1 month, `account.purge` at 30 days), reports/dashboard aggregates with safe caching. *Deployable: full feature parity + AI (stubbed) + GDPR retention.*

**Phase 7 — Hardening & extension seams.** Full security test pass, load test, circuit breakers, Stripe adapter behind existing `PaymentProvider`, second-org enablement test (prove multi-tenant isolation). *Deployable: production-hardened, expansion-ready.*

---

## 14. Remaining open questions

Almost everything is now locked. Only these remain — **none block any phase**, and each has a safe default:

1. **SMS provider:** Open by your choice — native vs. vendor (Twilio/Vonage/etc.). The `SmsPort` stub keeps reminders working until you decide. *(Phase 5.)*
2. **How many terms per year / term calendar:** A term is 12 weeks (confirmed). Remaining nicety: the fixed start dates of each term's block in the year, and any gaps between terms. Can be entered as data in Settings; no code impact. *(Phase 3, configurable.)*
3. **Archive storage target:** §0.5 archival tier defaults to a restricted S3 storage class (e.g. Glacier/IA) in UK/EU. Confirm if you'd prefer a different cold store. *(Phase 6, infra-only.)*

Everything else (terms, roll-over, billing, VAT, payroll basis, retention, AI stubbing + interfaces, calendar OAuth, reschedule rules) is confirmed and reflected above.

---

## 15. Recommendation

This design now reflects all confirmed decisions: Pinner UK studio, GBP/Europe-London, **no VAT** + **both invoice modes** with 7-day terms, §0.2 cancellation policy, **12-week terms with auto-enrol roll-over**, **hourly payroll on actual elapsed time** under Teachers & Staff, 5 rooms, no-expiry makeup credits, reschedule-approval flow (24h notice, no cap), **one-way per-teacher calendar push**, Resend email + stubbed SMS, **optional teacher-triggered AI from audio/video behind stub provider interfaces** (full §7.1 schemas/contracts/queues/storage), **§0.5 retention/archival** (1-month media → restricted archive; 30-day ex-student purge; pre-archival subject download), Drizzle, UK-GDPR residency, green-field. The three §14 items are non-blocking with safe defaults.

**Awaiting your approval. Phase 0 is not started.** When you're ready, the natural first increment is **Phase 0 + Phase 1** (foundations + identity/tenancy/RBAC). Just say go — and whether to run Phase 0 + 1 together or Phase 0 alone.
