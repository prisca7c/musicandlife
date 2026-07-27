# QA Survey Triage — captured 2026-07-22
Source: studio-owner survey + 32 screenshots (parent/student/teacher/admin portals).
This file exists so the detail survives context compaction. Screenshots are NOT recoverable — all
observations from them are transcribed below.

## A. CONFIRMED BUGS (seen in screenshots or reproduced)

| # | Bug | Evidence | Status |
|---|-----|----------|--------|
| A1 | **Payroll "Run all staff" → Internal server error** | Screenshot: modal shows red "Internal server error" | CONFIRMED |
| A2 | **Teacher "Reschedules" page stuck on "Loading…"** | Screenshot: teacher portal, never resolves | CONFIRMED |
| A3 | **Booking request "Confirm this time" disabled, no alternative offered** | 3 requests all greyed: "Clashes with another lesson", "Teacher isn't available on Thursdays". Teacher can ONLY Decline | CONFIRMED — this is the "can't click confirm" complaint |
| A4 | **Teacher cannot see resources they shared** | Teacher Resources = 1 item ("(TEST) scope teacher"); the 2 Bach family links they shared are missing. API: teacher 1 vs admin 4 | CONFIRMED |
| A5 | **Student sees 0 resources** | Student Resources: "0 items / No resources match your filters" (earlier showed 2) | CONFIRMED |
| A6 | **Admin "Send" button does nothing** on message thread | owner report + screenshot of composed msg | reported |
| A7 | **Stale identity in sidebar across role switches** | Sidebar showed "Teacher / QA Teacher (TEST)" while displaying ADMIN data (17 students, all teachers' calendars) | CONFIRMED (see §C) |
| A8 | Attendance row shows lesson at **23:00** (Nina Bianchi, Emily Reed) | admin Attendance screenshot | suspect timezone |
| A9 | Booking: **duration hardcoded 60 min**, no 30/45 choice | parent portal | CONFIRMED |
| A10 | **Availability editor allows only ONE day + ONE window** at a time | teacher "Add availability window" modal | CONFIRMED |
| A11 | "When your teacher is free" assumes **one teacher per family** | parent dashboard | design flaw |
| A12 | **Student booking makes the student select themselves** | student portal Book lesson | CONFIRMED |
| A13 | Duplicate resources listed twice (2x identical Bach links) | admin + student Resources | data/dedup |

## B. NOT BUGS — test-data artifacts (created by QA probing, delete before launch)
- INV-0008 = **£-4.00** negative invoice → drives "Invoice due £-4.00" and the confusing
  **"This invoice has nothing to pay."** (app is correctly refusing a negative invoice)
- INV-0009..0014 = **£1.00 / £3.33** junk invoices ("why £1.00 😂")
- Bogus **+£9,999,999.99** cash payment (id 59712503) on QA Test Family → balance ~ +£9,999,884
- Extra -4500 charges on lesson 7094b334; lesson 5c49c38c left absent_no_pay
- Families: RACETEST…(x2), ZZ Concurrency, QAstudentJW/JW1/P4, "test p4", "james wang"
- 2 duplicate "David Okafor (demo)" payroll drafts; qa.teacher hourlyRate=4200
- Internal note "ZZ-SECRET-INTERNAL-*"; intake rows "(TEST)ZZ Probe", "dsf sdf", "ZZQATEST IGNORE"

## C. ROOT CAUSE — "the system mixed up admin and teacher"
VERIFIED via API: teacher scoping is CORRECT (teacher sees 2 students not 17; lessons from 1
teacherId only; only threads they participate in). **No authorization leak.**
Real cause = one auth cookie per domain. Logging into a 2nd portal in the SAME browser replaces
the 1st session, so you get one role's identity in the sidebar with another role's data.
Explains: admin/teacher mix-up, "QA student vanished from parent portal" (fixed by using
Safari+Chrome), "teachers see all students", "teachers see admin↔parent messages".
=> The *collision* is normal browser behaviour. The *bug* is the UI not clearing cached
identity/data on login/logout (stale SWR cache).

## D. NEEDS YIYI'S DECISION (do not guess)
1. "Confirm payment" / "I've paid this" is **honour-system** — nothing verifies a real transfer. Intended?
2. Full lesson-type list + durations (30/45/60) + correct rate per type. Group = always 60min?
3. Resource access model: all students see all? general vs paid/subscription vs per-student?
4. May admin read parent↔teacher messages? If yes, both parties must be told up front (privacy).
5. Should students be able to message teachers (like parents can)?
6. Show upload date on resources?
7. What belongs on the STUDENT homepage vs PARENT homepage?
8. Is "Intake" = new students? Rename to "New students" + move "Add student" there?
9. Does she pay teachers monthly? (drives the Salary-by-month page)
10. Are individual attendance histories better placed inside the Student page?

## E. FEATURE REQUESTS
- Lesson duration + price picker (£45/30min style labels)
- WhatsApp-style message layout; clearer "who am I talking to"; unread badges; push notifications
- Parents/students upload pic/vid to teacher (practice clips, competition videos, questions)
- Monthly attendance timetable for all students
- **"My salary" page per month** (teacher + admin): # students, lesson types, rate, total, saved per month
- Teacher-initiated rescheduling
- Notes page split by audience (family / staff / student) — PARTIALLY DONE (family+staff columns exist, Attach media works)
- Attendance history search by student name
- Content/Repertoire page is a placeholder ("CRUD UI is next sprint")
- More seed data: multi-instrument students, multi-instrument teachers, families with children
  across different instruments/teachers/group classes

## F. VERIFIED SOLID (do not re-test)
Cross-family/role IDOR (13/14 probes 403), teacher dashboard scoping (revenue £0, own students only),
internal notes hidden from parents, all 12 protected endpoints 401 unauthenticated, login gives
identical "Invalid credentials", register rejects weak pw/bad email/role escalation, no foreign-thread
read/write, double-decide guards (lesson req, reschedule, rate change, payroll), signed file download
validates note+attachment+org.

## G. SHIPPED THIS SESSION (live on prod)
#56–#69 all verified live. Attendance billing: charge once → re-mark = no-op → cancel refunds exactly.
PR #70 (OPEN): password-reset timing oracle (8.1x) fix — needs merge+deploy, then re-run hammer_timing.mjs.
FLAGGED: /threads/recipients leaks staff email addresses to guardians (incl. personal Gmail).

## H. ADMIN-PORTAL SWEEP — 2026-07-24 (this session)

### Fixed & shipped in PR #123 (fix/revenue-bound-payment-cap)
- **Revenue KPI missing month upper bound** — reports.service.ts summed every `payment`
  ledger entry `>= monthStart` with no `lte(monthEnd)` (the lessons query has both).
  Future-dated payments leaked into "this month" (proved by ~£45 gap: bounded report
  £10,000,223 vs dashboard £10,000,268). Added the missing bound.
- **Record Payment had no client max** — input had min=0.01 but no max, so a fat-fingered
  extra zero passed silently to the ledger (how £10M got in). Added max=£1,000,000 (server
  cap) + a confirm() prompt for any amount over £10,000.
- **Staff rate over-cap error leaked raw DTO field name** — "hourlyRate must not be greater
  than 1000000". Added friendly @Max message "Hourly rate must not exceed £10,000."
- **Create-invoice custom line-item had no client max** — added max=100000 to match the
  ±£100,000 /line-items server cap.

### New findings (not yet fixed)
| # | Sev | Surface | Finding |
|---|-----|---------|---------|
| H1 | Med | Billing views | Credit-note presentation is inconsistent: INV-0008 shows "£4.00 credit" + green "Credit" badge on the Billing LIST (#122 fix) but "-£4.00 / sent" on the FAMILY DETAIL invoice table. #122 fix didn't propagate to family detail. |
| H2 | Med | Staff | Two TEST teachers use REAL Gmail addresses (manameizhallo@gmail.com, asunalover0@gmail.com on "QAteacherOne/Two TESTdelete"). A teacher broadcast would hit real inboxes. |
| H3 | Low | Family detail | "Balance: £X" shown with no credit-vs-owed indicator (families LIST distinguishes "owed"; detail doesn't). A £10M credit and £10M debt look identical. |
| H4 | Low | Staff | Malformed record "(TEST)ZZ Sane": empty CONTACT card (no email/phone), no title, no instruments. |
| H5 | Low | Intake | Public sign-up form accepts near-garbage: "dsf sdf / sdf dsf / 2@gmail.com" reached the pending queue. |

### Verified GOOD this sweep (do not re-test)
- Staff rate editor client validation: negative rate → "Enter a valid rate"; duration 0 →
  "Duration must be 5–240 minutes"; server caps rate at £10,000/hr.
- #122 credit-note fix live on Billing LIST (INV-0008 green "Credit"), outstanding sane (£2.00).
- Create-invoice: family-required guard ("Please select a family"); Monthly/Per-lesson/Custom
  + per-class split all present.
- Broadcasts: excellent guardrails (test-send, live recipient count in send button, required-field gating).
- Family detail has a "Merge duplicate" button — remedy for RACETEST duplicate families exists.

### Sweep continued 2026-07-25 (Calendar / Attendance / Messages)
| # | Sev | Surface | Finding |
|---|-----|---------|---------|
| H6 | Med (privacy) | Messages · Staff↔family | Admin can READ all teacher↔parent private threads via the oversight tab. Impl is careful (read-only, opening doesn't mark-read for them, no reply). GAP: no disclosure to the teacher/parent that their DMs are admin-visible — GDPR/consent concern for a UK studio. (Resolves open Q D4: admins CAN read; disclosure is the missing piece.) |
| H7 | Med (data/tz) | Calendar / Attendance | Cluster of lessons at 22:00–23:30 all week (Mia Harper, Nina Bianchi 23:00, An/Bao Nguyen, Luca/Sofia Bianchi) — all demo families, all rendering WITHOUT teacher/instrument unlike well-formed lessons. Timezone offset or orphaned demo seed (confirms A8). |
| H8 | Low (copy) | Attendance | Day view for a date whose only lessons are still in the future shows "No scheduled lessons for <date>" — misleading; there IS an upcoming lesson (e.g. Sat 25 has a 10:00 booking on the calendar). Should distinguish "nothing to mark yet" from "no lessons". |

### Verified GOOD (continued)
- Messages A6 ("Send does nothing") is FIXED — thread shows successful admin sends + parent reply; Send button disabled when empty, enables on typing.
- Attendance vs Calendar reconcile correctly: group sessions (Suzuki Group A: Emeka+Leo) render as 2 calendar blocks but ONE markable attendance row — no lessons lost.
- Attendance option sets differ correctly by type: Group = Present/Absent/Cancelled; Private = 5-way (Present / Cancelled ≥24h / Cancelled <24h / Absent–no charge / Teacher cancel).
- Calendar: whole-studio week view, teacher/student filters, per-teacher colour, type legend. (Minor: 11 teachers → colour swatches hard to distinguish; two near-identical purples.)

### Sweep continued 2026-07-25 pt.2 (Booking / Reschedules / Students)
FIXED & shipped in PR #124: H1 (family-detail credit label) + H6 (admin-oversight disclosure notice).

| # | Sev | Surface | Finding |
|---|-----|---------|---------|
| H9 | Med | Booking requests | Double-booking risk: "(TEST) dbl A" and "(TEST) dbl B" both propose the SAME slot (Wed 22 Jul 16:00), both show "Free & within your hours", both Confirm buttons ENABLED (verified via .disabled=false). Availability is checked per-request, ignoring the other pending request for that slot. Needs a server-side atomic re-check at confirm time — couldn't test the actual confirm (creates a real lesson; needs owner OK). |
| H10 | Med | Booking requests | No past-date guard: Wed 22 Jul is in the PAST (today 25 Jul) yet both dbl requests are confirmable. "Free & within your hours" only checks weekly availability, not whether the slot has already passed. (The "(TEST) past" Thu 9 Jul one is disabled, but for the Thursday-availability rule, not for being past.) |
| H11 | Low | Reschedules | Two pending reschedule requests for the SAME lesson (An Nguyen Mon 27 Jul 12:00) — one from qa.student, one from qa.parent. Conflict/clutter; both happen to be un-approvable here so no hard failure. |
| H12 | Low | Students | Duplicate student records: "RACETEST1783827920 QAraceDELETE" ×2 and "Joanne Tsang" ×2 (mirrors the duplicate families — same concurrency/dedup gap). |

### Verified GOOD (continued pt.2)
- Booking A3 ("can't confirm / no alternative") LARGELY FIXED: confirmable requests have an
  ENABLED "Confirm this time"; unavailable ones offer "None of these work — suggest a time".
- Reschedules A2 ("stuck on Loading") FIXED — page renders.
- Reschedule "Approve this time" correctly DISABLED (verified .disabled=true) when the preferred
  slot is flagged unavailable ("teacher isn't available on Tuesdays").

## §I — Admin sweep pt.3 (Intake / Students / Family-merge) — 2026-07-24

### H10 — Booking/reschedule confirm accepts PAST times — FIXED (PR #124)
createLessonRequest blocked proposing a past time, but confirm / counter-propose /
reschedule-approve only checked teacher availability + lesson conflicts. A request made
days earlier naming a since-passed slot could be confirmed into a past-dated lesson.
Fix: past-time guard added once at the shared chokepoint teacherUnavailableReason, so the
request lists now show ok:false (Confirm/Approve disabled) AND the write paths reject 400.

### H9 — Booking double-book display — VERIFIED SAFE (no code change)
Two pending requests for the same slot both show "Free" and both Confirm buttons enable,
BUT createLesson takes a per-teacher advisory xact lock + re-checks conflicts inside the txn
(scheduling.service lockResources/checkConflicts), so the 2nd confirm throws "That time
clashes". No real double-booking possible. Residual is cosmetic only; H10 fix shrinks it.

### H13 — Intake approve with NO email overpromises — FIXED (PR #124)
"Approve & create accounts" always said "Sends a welcome email with portal login link", but
registration.service only wires the portal account + welcome email "if contact email
provided". With no email the family/student/enrollments are created but NO email and NO login
— admin misled into thinking an invite went out. Fix: conditional copy + amber warning
("No email on file — this family won't get a welcome email or a portal login…") + render the
blank email row as "None on file". Button stays enabled (creating the family is still valid).

### H14 — Family MERGE fails for any family with payment claims — FIXED (PR #124)  [Med]
mergeFamilies reassigned students/guardians/invoices/ledgerEntries/payments but NOT
paymentClaims.familyId (NOT NULL) or bankTransactions.matchedFamilyId — both auto-generated
by the bank-transfer pay flow, both FK families ON DELETE NO ACTION. So `delete(source)`
FK-violated → whole txn rolled back → merge silently failed for any family that ever paid by
transfer, surfacing only the generic "Could not merge families". Fix: reassign both before
the delete. Verified all 7 family-FK tables now covered (grep references(() => families.id)).

### Verified GOOD pt.3
- Student detail page: profile / family / notes (INTERNAL vs FAMILY tags) / enrollments with
  per-instrument rates all render correctly; DOB empty shows "—".
- Add-note "Save note(s)" enabled while empty but submit no-ops (page.tsx:314 guards
  `!familyNote.trim() && !privateNote.trim()`). Family/Private visibility clearly labelled.
- Merge modal: manager+ gated (canMerge role check), two-step confirm ("will be absorbed and
  removed"), self-merge blocked server-side (targetId===sourceId → 400).

## §J — Admin sweep pt.4 (Enquiries/Waitlist + CSV import) — 2026-07-24

### H15 — whitespace-only lead name accepted — FIXED (PR #124)  [Low]
Add-lead sent name untrimmed; "   " passed HTML5 required + server @MinLength(1), storing a
blank-looking lead. Fix: @Transform trim on CreateLeadDto.name before MinLength → rejected.

### O1 — future/typo studentDob accepted everywhere — FIXED (PR #124)
Not just CSV: create-student.dto, submit-registration.dto (public form!) and CSV
validateImportRow all accepted any parseable date, so a typo'd year (2062, or 0202) created a
student not-yet-born or aged 100+. Fix: shared @IsRealisticDob validator
(common/validators/is-realistic-dob.ts) — rejects future dates + years <1900 — applied to
both DTOs (UpdateStudentDto inherits via PartialType) with the same bound inlined in
validateImportRow. Verified logic: past/today pass, future & pre-1900 fail, empty passes.

### O2 — CSV import: instrument is free-text — OBSERVATION (by design)
No allowlist on the instrument column, but that's consistent with the rest of the app
(instruments are free-form everywhere). Not a bug.

### Verified GOOD pt.4
- CSV parser (common/csv.parseCsv): RFC4180-ish — quoted commas/newlines/escaped quotes,
  skips blank lines, ragged rows safe via `?? ''`. No crash paths found.
- validateImportRow: required fields, email regex, lessonType enum ('private'|'group'),
  DOB parseability all enforced; commitImport re-validates each row before creating.
- Add-lead: Name required (HTML5 + server); Contact free-form "email or phone" by design.

### Still UNTESTED
Notes admin drill-down (internal-note privacy already verified in §F); lead status
transitions (mutations, skipped — note: "Converted" is a label only, no auto student-create);
enrollment status-change / "Stop weekly" (mutations, skipped).

### Prod cleanup still outstanding (pre-launch)
Staff 10/10 test/demo; Families 19/19 test/demo incl. £9,999,789.66 pollution balance on
QA Test Family and duplicate RACETEST1783827920fam (x2); 27 students incl. dup RACETEST x2 &
Joanne Tsang x2; 3 pending sign-ups all (TEST)/junk. Purge QA data before go-live.
