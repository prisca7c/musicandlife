import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { eq, and, gte, lte, ne, or, isNull, inArray, sql } from 'drizzle-orm';
import { lessons, rescheduleRequests, lessonRequests, lessonCredits, availability, blockedTime, students, staffMembers, guardians, organizations, enrollments, users, invoiceLineItems, invoices } from '@music-life/db';
import type { Db } from '@music-life/db';
import { DbService } from '../db/db.service';
import type { CreateLessonDto } from './dto/create-lesson.dto';
import type { UpdateLessonDto } from './dto/update-lesson.dto';
import type { CancelLessonDto } from './dto/cancel-lesson.dto';
import type { CreateRescheduleRequestDto } from './dto/reschedule-request.dto';
import type { CreateLessonRequestDto } from './dto/lesson-request.dto';
import type { BaseRole } from '@music-life/types';
import { NotificationsService } from '../notifications/notifications.service';
import { parseZonedDateTime, zonedWeekdayAndTime, formatInZone } from '../common/timezone';

// Resolves to the caller's own staffId when their role is exactly 'teacher' (so service
// methods can scope/ownership-check); higher roles (receptionist+) act unrestricted.
export interface Actor { role: BaseRole; userId: string }

// How many weeks ahead recurring weekly lessons are materialised as real rows.
export const RECURRENCE_WINDOW_WEEKS = 12;

// Only a live lesson can be moved. 'scheduled' is a normal upcoming lesson;
// 'makeup' is a real upcoming make-up lesson. A 'completed' or any 'cancelled_*'
// lesson is a settled historical record — moving it would resurrect a dead slot,
// re-timetable a teacher and confuse billing/attendance. Any reschedule path
// (staff direct move, family request approval, veto-review move) must refuse it.
const RESCHEDULABLE_LESSON_STATUSES = ['scheduled', 'makeup'] as const;

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

/**
 * Naive wall-clock datetime strings ("YYYY-MM-DDThh:mm:00") for every weekly
 * occurrence of `weekday`/`startTime` in the studio's timezone, from `from`
 * (exclusive of times already past today) through `weeks` weeks ahead.
 *
 * Occurrences are stepped on the studio-local calendar and returned as *naive*
 * strings so the caller can hand them straight to createLesson, which interprets
 * them in the studio zone — this keeps recurring lessons on the same wall-clock
 * time across DST changes (16:00 stays 16:00, not drifting to 15:00/17:00).
 */
export function weeklyOccurrenceStrings(
  from: Date, weeks: number, weekday: string, startTime: string, timeZone: string,
): string[] {
  const targetDow = WEEKDAY_INDEX[weekday.toLowerCase()];
  if (targetDow === undefined) return [];
  if (!/^\d{1,2}:\d{2}$/.test(startTime)) return [];

  // Studio-local "today" as YYYY-MM-DD (en-CA renders ISO order).
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(from);
  const [y, mo, d] = todayStr.split('-').map(Number);

  // Anchor at UTC noon so weekday + date stepping are DST-proof (the calendar
  // date of a noon-UTC instant matches the studio-local date for all real zones).
  const cursor = new Date(Date.UTC(y!, mo! - 1, d!, 12));
  while (cursor.getUTCDay() !== targetDow) cursor.setUTCDate(cursor.getUTCDate() + 1);

  const windowEnd = new Date(from.getTime() + weeks * 7 * 86400000);
  const out: string[] = [];
  for (let i = 0; i <= weeks; i++) {
    const yy = cursor.getUTCFullYear();
    const mm = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(cursor.getUTCDate()).padStart(2, '0');
    const [hh, min] = startTime.split(':');
    const naive = `${yy}-${mm}-${dd}T${hh!.padStart(2, '0')}:${min}:00`;
    const instant = parseZonedDateTime(naive, timeZone);
    if (instant >= from && instant <= windowEnd) out.push(naive);
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return out;
}

// The executor passed to conflict-checking helpers — either the pooled db or an
// open transaction. Booking writes always run on a transaction so the conflict
// check and the insert/update are atomic and hold the same advisory locks.
type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

@Injectable()
export class SchedulingService {
  private readonly logger = new Logger(SchedulingService.name);

  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationsService,
  ) {}

  // Booking conflicts are check-then-act, which races: two concurrent bookings can
  // both pass the conflict check and then both insert, double-booking a teacher.
  // To serialize per-teacher we take a Postgres transaction-scoped advisory lock
  // keyed on the teacher before checking + writing. This is robust against
  // overlapping (not just identical) slots and needs no schema change / clean
  // data — unlike a unique index.
  //
  // Also lock on the STUDENT: checkConflicts independently checks the student
  // isn't double-booked, but that check used to run under only the teacher's
  // lock. Two concurrent bookings for the same student with two DIFFERENT
  // teachers took two different teacher locks and could both pass the
  // student-clash check before either committed — the student ends up booked
  // with both teachers at once. Locking both ids (in a fixed order to avoid a
  // teacher-lock-then-student-lock vs student-lock-then-teacher-lock deadlock)
  // closes that gap the same way the teacher lock closes the teacher one.
  private async lockResources(tx: Executor, orgId: string, teacherId?: string | null, studentId?: string | null) {
    const keys = [
      teacherId ? `lesson:${orgId}:teacher:${teacherId}` : null,
      studentId ? `lesson:${orgId}:student:${studentId}` : null,
    ].filter((k): k is string => k !== null).sort();
    for (const key of keys) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    }
  }

  private async resolveStaffId(orgId: string, userId: string): Promise<string | null> {
    const staff = await this.db.db.query.staffMembers.findFirst({
      where: and(eq(staffMembers.userId, userId), eq(staffMembers.organizationId, orgId)),
      columns: { id: true },
    });
    return staff?.id ?? null;
  }

  // A family user is either a guardian or a student with their own login; both
  // resolve to a familyId (students link via studentUserId). Mirrors the
  // family-portal resolver — used to scope family-initiated actions to their own
  // family's lessons.
  private async resolveFamilyId(orgId: string, userId: string): Promise<string | null> {
    const guardian = await this.db.db.query.guardians.findFirst({
      where: and(eq(guardians.userId, userId), eq(guardians.organizationId, orgId)),
      columns: { familyId: true },
    });
    if (guardian) return guardian.familyId;
    const student = await this.db.db.query.students.findFirst({
      where: and(eq(students.studentUserId, userId), eq(students.organizationId, orgId)),
      columns: { familyId: true },
    });
    return student?.familyId ?? null;
  }

  // ─── Lessons ──────────────────────────────────────────────────────────────
  async getLessons(
    orgId: string,
    params: { weekStart?: string; from?: string; to?: string; teacherId?: string; studentId?: string; scope?: string },
    actor?: Actor,
  ) {
    const base = eq(lessons.organizationId, orgId);

    // An explicit from/to window, for views wider than a week (the monthly
    // attendance grid). Bounded in SQL rather than fetched and filtered: with
    // neither weekStart nor a range this query returns EVERY lesson the studio
    // has ever run, which is fine at today's size and won't stay fine.
    const range = params.from || params.to
      ? and(
          base,
          params.from ? gte(lessons.startsAt, new Date(`${params.from}T00:00:00`)) : undefined,
          params.to ? lte(lessons.startsAt, new Date(`${params.to}T23:59:59.999`)) : undefined,
        )
      : null;

    const rows = await this.db.db.query.lessons.findMany({
      where: range
        ? range
        : params.weekStart
        ? and(base,
            gte(lessons.startsAt, new Date(params.weekStart)),
            lte(lessons.startsAt, new Date(new Date(params.weekStart).getTime() + 7 * 86400 * 1000)))
        : base,
      with: {
        student: { columns: { id: true, firstName: true, lastName: true } },
        teacher: { columns: { id: true, firstName: true, lastName: true } },
        attendance: { columns: { status: true } },
        // enrollment.teacherId is the lesson's NORMAL teacher (per the student's
        // enrolment) — compared against the lesson's own teacherId client-side to
        // detect a one-off substitute (someone covering for the usual teacher).
        enrollment: { columns: { instrument: true, lessonType: true, groupName: true, teacherId: true } },
      },
      orderBy: (l, { asc }) => [asc(l.startsAt)],
    });

    const withPayment = await this.attachPaymentStatus(rows);

    if (actor?.role === 'teacher') {
      const staffId = await this.resolveStaffId(orgId, actor.userId);

      // Opt-in whole-studio view (the calendar's "everyone" mode). A teacher may
      // look at the full schedule to see who's teaching when — but a lesson's
      // private notes stay with the teacher who wrote them, so they're stripped
      // from lessons this teacher doesn't teach. The teacherId/studentId filters
      // work the same as for management here. This is read-only: every mutation
      // still goes through assertOwnsLesson, so seeing a lesson never means being
      // able to touch it. Payment status IS shown across teachers — the studio
      // owner wants any teacher glancing at the calendar to see who's paid,
      // without exposing payroll (that stays gated in staff.service.ts).
      if (params.scope === 'all') {
        let scoped = withPayment;
        if (params.teacherId) scoped = scoped.filter(r => r.teacherId === params.teacherId);
        if (params.studentId) scoped = scoped.filter(r => r.studentId === params.studentId);
        return scoped.map(r => (r.teacherId === staffId ? r : { ...r, notes: null }));
      }

      // Default: a teacher sees only their own lessons, regardless of the
      // teacherId param — it must not be possible to view another teacher's
      // schedule by passing their id. studentId still narrows further, e.g.
      // "this student's lessons that I teach". Attendance relies on this scoping.
      let scoped = withPayment.filter(r => r.teacherId === staffId);
      if (params.studentId) scoped = scoped.filter(r => r.studentId === params.studentId);
      return scoped;
    }

    if (params.teacherId) return withPayment.filter(r => r.teacherId === params.teacherId);
    if (params.studentId) return withPayment.filter(r => r.studentId === params.studentId);
    return withPayment;
  }

  // Batch-derives a per-lesson payment status from the invoice line item it was
  // itemised onto (if any). One query for the whole page of lessons rather than
  // N+1 — the calendar can render 100+ lessons for a busy week.
  //   paid     → itemised on an invoice marked paid
  //   unpaid   → itemised on a draft/sent invoice
  //   void     → itemised on a voided invoice
  //   unbilled → not yet itemised onto any invoice (e.g. lesson hasn't happened,
  //              or billing hasn't run yet for its period)
  private async attachPaymentStatus<T extends { id: string }>(rows: T[]): Promise<(T & { paymentStatus: 'paid' | 'unpaid' | 'void' | 'unbilled' })[]> {
    if (rows.length === 0) return [];
    const billed = await this.db.db
      .select({ lessonId: invoiceLineItems.lessonId, status: invoices.status })
      .from(invoiceLineItems)
      .innerJoin(invoices, eq(invoiceLineItems.invoiceId, invoices.id))
      .where(inArray(invoiceLineItems.lessonId, rows.map(r => r.id)));
    const map = new Map<string, 'paid' | 'unpaid' | 'void'>();
    for (const b of billed) {
      if (!b.lessonId) continue;
      map.set(b.lessonId, b.status === 'paid' ? 'paid' : b.status === 'void' ? 'void' : 'unpaid');
    }
    return rows.map(r => ({ ...r, paymentStatus: map.get(r.id) ?? 'unbilled' }));
  }

  async getLesson(orgId: string, id: string, actor?: Actor) {
    const lesson = await this.db.db.query.lessons.findFirst({
      where: and(eq(lessons.id, id), eq(lessons.organizationId, orgId)),
      with: {
        student: { columns: { id: true, firstName: true, lastName: true } },
        teacher: { columns: { id: true, firstName: true, lastName: true } },
        attendance: true,
        enrollment: { columns: { id: true, instrument: true, lessonType: true, groupName: true, teacherId: true } },
      },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    const [withPayment] = await this.attachPaymentStatus([lesson]);
    if (actor?.role === 'teacher') {
      const staffId = await this.resolveStaffId(orgId, actor.userId);
      // A teacher can open any lesson's detail from the whole-studio calendar,
      // but another teacher's private notes are withheld. Mutations remain gated
      // by assertOwnsLesson, so read access here grants nothing more.
      if (lesson.teacherId !== staffId) return { ...withPayment!, notes: null };
    }
    return withPayment!;
  }

  // `notify` defaults true (a genuine one-off booking). Both bulk call sites —
  // materializeEnrollment's recurring backfill (could be dozens of lessons per
  // run) and createFamilyBooking (which already sends its own richer
  // confirmation email) — explicitly pass false so this never double-notifies
  // or spams a family/teacher with one banner per generated week.
  async createLesson(orgId: string, dto: CreateLessonDto, opts?: { seriesSlotAt?: Date; notify?: boolean }) {
    // A caller-supplied teacherId must belong to this org. Without this, a bad (or
    // foreign-org) id slips past the conflict check and blows up on the row's
    // foreign key — surfacing as a 500 to the family portal. Validate up front so
    // it comes back as a clean 404 and no lesson references another org's teacher.
    // Same class of gap enrollments.create() and staff.assignStudent() already
    // close: an inactive teacher or withdrawn student must not be booked into a
    // new lesson (and, downstream, billed) via this path either.
    if (dto.teacherId) {
      const teacher = await this.db.db.query.staffMembers.findFirst({
        where: and(eq(staffMembers.id, dto.teacherId), eq(staffMembers.organizationId, orgId)),
        columns: { id: true, status: true },
      });
      if (!teacher) throw new NotFoundException('Teacher not found');
      if (teacher.status !== 'active') {
        throw new BadRequestException('This teacher is not active. Choose an active teacher, or reactivate them first.');
      }
    }
    const student = await this.db.db.query.students.findFirst({
      where: and(eq(students.id, dto.studentId), eq(students.organizationId, orgId)),
      columns: { id: true, status: true },
    });
    if (!student) throw new NotFoundException('Student not found');
    if (student.status === 'withdrawn') {
      throw new BadRequestException('This student has been withdrawn and can’t be booked for a lesson.');
    }
    const lesson = await this.db.db.transaction(async (tx) => {
      const tz = await this.getOrgTimezone(tx, orgId);
      // Interpret a naive wall-clock ("...T16:00:00") as the studio's local time.
      const startsAt = parseZonedDateTime(dto.startsAt, tz);
      await this.lockResources(tx, orgId, dto.teacherId, dto.studentId);
      await this.checkConflicts(tx, orgId, startsAt.toISOString(), dto.duration ?? 60, dto.teacherId, undefined, dto.studentId);

      const [row] = await tx
        .insert(lessons)
        // seriesSlotAt (recurrence worker only) records the canonical weekly slot
        // so a later reschedule can't vacate it and trigger a duplicate top-up.
        .values({ ...dto, organizationId: orgId, startsAt, seriesSlotAt: opts?.seriesSlotAt })
        .returning();
      return row!;
    });

    if (opts?.notify !== false) {
      this.notifyBooked(orgId, lesson).catch((e) => this.logger.warn(`lesson.booked notify failed: ${e}`));
    }
    return lesson;
  }

  /**
   * In-app + email notification when a lesson is put on the calendar by staff
   * (the admin "Add lesson" dialog, or confirming a lesson request) — the one
   * creation path that previously told no one. Reaches the teacher and every
   * portal LOGIN the student's family has (guardians + the student's own
   * account, if any) — a bare contact email with no login can't receive an
   * in-app banner, so those still only get the family confirmation flow's
   * separate email where applicable.
   */
  private async notifyBooked(orgId: string, lesson: { id: string; studentId: string; teacherId: string | null; startsAt: Date; duration: number }) {
    const [student, teacher] = await Promise.all([
      this.db.db.query.students.findFirst({
        where: eq(students.id, lesson.studentId),
        columns: { firstName: true, lastName: true, studentUserId: true },
        with: { family: { columns: { id: true } } },
      }),
      lesson.teacherId
        ? this.db.db.query.staffMembers.findFirst({
            where: eq(staffMembers.id, lesson.teacherId),
            columns: { firstName: true, lastName: true, userId: true },
          })
        : Promise.resolve(null),
    ]);
    if (!student) return;

    const familyGuardians = student.family
      ? await this.db.db.query.guardians.findMany({
          where: eq(guardians.familyId, student.family.id),
          columns: { userId: true },
        })
      : [];

    const recipientUserIds = new Set<string>();
    if (teacher?.userId) recipientUserIds.add(teacher.userId);
    if (student.studentUserId) recipientUserIds.add(student.studentUserId);
    for (const g of familyGuardians) recipientUserIds.add(g.userId);
    if (recipientUserIds.size === 0) return;

    const tz = await this.getOrgTimezone(this.db.db, orgId);
    const when = formatInZone(lesson.startsAt, tz, {
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    });
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const studentName = esc(`${student.firstName} ${student.lastName}`);
    const teacherName = teacher ? esc(`${teacher.firstName} ${teacher.lastName}`) : 'a teacher';
    const body = `${studentName}'s lesson with ${teacherName} is now on ${when} (${lesson.duration} min).`;

    for (const userId of recipientUserIds) {
      const recipientUser = await this.db.db.query.users.findFirst({ where: eq(users.id, userId), columns: { email: true } });
      await this.notifications.trigger('lesson.booked', {
        orgId, userId, email: recipientUser?.email, body,
      });
    }
  }

  // ─── Recurring weekly lessons ──────────────────────────────────────────────
  /**
   * Materialise real lesson rows for one enrollment's weekly schedule, from now
   * through `weeks` weeks ahead. Idempotent: occurrences that already have a
   * lesson (same enrollment + instant) are skipped, so it's safe to call
   * repeatedly (on schedule-rule change, and from the daily top-up worker).
   * Conflicts (teacher already booked) are skipped and counted, not thrown,
   * so one clash never aborts the whole series.
   */
  async materializeEnrollment(
    orgId: string,
    enrollmentId: string,
    opts?: { weeks?: number; fromDate?: string },
  ): Promise<{ created: number; skippedExisting: number; skippedConflicts: number; through: string; weeks: number }> {
    const weeks = Math.min(Math.max(opts?.weeks ?? RECURRENCE_WINDOW_WEEKS, 1), 520);

    const enrollment = await this.db.db.query.enrollments.findFirst({
      where: and(eq(enrollments.id, enrollmentId), eq(enrollments.organizationId, orgId)),
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');

    const rule = enrollment.scheduleRule as { weekday?: string; startTime?: string; endDate?: string } | null;
    if (!rule?.weekday || !rule?.startTime) {
      throw new BadRequestException('This enrollment has no weekly schedule (weekday + time) set');
    }

    // materializeAllRecurring pre-filters inactive teachers before calling this,
    // but this is also reachable directly (POST /lessons/recurring, e.g. booking
    // a recurring lesson from the calendar), which had no such guard — letting a
    // receptionist materialize a real, billable series under a teacher who's
    // already been deactivated. Same class of bug as #172; enforce it here too
    // so both callers are covered by one check instead of two that can drift.
    if (enrollment.teacherId) {
      const teacher = await this.db.db.query.staffMembers.findFirst({
        where: eq(staffMembers.id, enrollment.teacherId),
        columns: { status: true },
      });
      if (teacher && teacher.status !== 'active') {
        throw new BadRequestException('This lesson’s teacher is no longer active, so weekly lessons can’t be scheduled. Reassign the enrollment to an active teacher first.');
      }
    }

    const tz = await this.getOrgTimezone(this.db.db, orgId);
    // A recurring series can carry a last date — never generate past the end of
    // that studio-local day.
    const endCap = rule.endDate ? parseZonedDateTime(`${rule.endDate}T23:59:59`, tz) : null;
    // A supplied start date is a studio-local wall-clock date; interpret it in the
    // studio zone. Never generate lessons in the past: clamp to now so back-dated
    // enrollments don't create historical rows.
    const now = new Date();
    const fromArg = opts?.fromDate
      ? parseZonedDateTime(opts.fromDate.includes('T') ? opts.fromDate : `${opts.fromDate}T00:00:00`, tz)
      : now;
    const from = fromArg > now ? fromArg : now;
    const windowEnd = new Date(from.getTime() + weeks * 7 * 86400000);
    const occurrences = weeklyOccurrenceStrings(from, weeks, rule.weekday, rule.startTime, tz);

    // Dedup on the canonical SLOT, not the current start time. A lesson occupies
    // its slot via seriesSlotAt, which a reschedule never touches — so moving a
    // recurring lesson off its weekly slot no longer leaves that slot looking
    // empty (the bug that made the next run regenerate a duplicate there and
    // double-bill the family). Match a lesson whose slot OR (for legacy/one-off
    // rows not yet stamped) whose start falls in the window.
    const existing = await this.db.db.query.lessons.findMany({
      where: and(
        eq(lessons.enrollmentId, enrollment.id),
        or(
          and(gte(lessons.seriesSlotAt, from), lte(lessons.seriesSlotAt, windowEnd)),
          and(isNull(lessons.seriesSlotAt), gte(lessons.startsAt, from), lte(lessons.startsAt, windowEnd)),
        ),
      ),
      columns: { id: true, startsAt: true, seriesSlotAt: true },
    });
    const bySlot = new Map<number, { id: string; stamped: boolean }>();
    for (const l of existing) {
      const slot = (l.seriesSlotAt ?? l.startsAt).getTime();
      if (!bySlot.has(slot)) bySlot.set(slot, { id: l.id, stamped: !!l.seriesSlotAt });
    }

    let created = 0, skippedExisting = 0, skippedConflicts = 0;
    for (const naive of occurrences) {
      const instant = parseZonedDateTime(naive, tz);
      if (endCap && instant.getTime() > endCap.getTime()) break; // occurrences are ascending
      const hit = bySlot.get(instant.getTime());
      if (hit) {
        skippedExisting++;
        // Adopt a legacy/one-off row sitting exactly on this slot (e.g. the first
        // lesson of a recurring family booking, or lessons created before this
        // column existed): stamp its slot so a later reschedule can't vacate it
        // and spawn a duplicate on the next run. Self-heals within one pass.
        if (!hit.stamped) {
          await this.db.db.update(lessons).set({ seriesSlotAt: instant }).where(eq(lessons.id, hit.id));
        }
        continue;
      }
      try {
        await this.createLesson(orgId, {
          studentId: enrollment.studentId,
          startsAt: naive,
          duration: enrollment.defaultDuration,
          teacherId: enrollment.teacherId ?? undefined,
          enrollmentId: enrollment.id,
          termId: enrollment.termId ?? undefined,
        }, { seriesSlotAt: instant, notify: false });
        created++;
      } catch (err) {
        skippedConflicts++;
        this.logger.warn(
          `Skipped recurring lesson for enrollment ${enrollment.id} at ${naive}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return { created, skippedExisting, skippedConflicts, through: windowEnd.toISOString(), weeks };
  }

  /**
   * Top up recurring lessons for every active enrollment that has a weekly
   * schedule. Used by the daily RecurrenceWorker. `orgId` scopes the scan (tests
   * pass a throwaway org); omitted = all orgs.
   */
  async materializeAllRecurring(orgId?: string): Promise<{ created: number; skippedExisting: number; skippedConflicts: number }> {
    const active = await this.db.db.query.enrollments.findMany({
      where: orgId
        ? and(eq(enrollments.status, 'active'), eq(enrollments.organizationId, orgId))
        : eq(enrollments.status, 'active'),
      columns: { id: true, organizationId: true, scheduleRule: true, teacherId: true },
    });

    // When a teacher leaves, the office deactivates them (staffMembers.status =
    // 'inactive'); the roster and calendar drop them at once. But nothing
    // cascades to their enrolments, and this worker keys on the ENROLMENT's
    // status alone — so without this guard it would keep generating a fresh week
    // of lessons under a teacher who has gone, which autoCompleteOverdue then
    // marks present and BILLS the family. Skip any enrolment whose teacher is no
    // longer active. Generation resumes on its own once the student is reassigned
    // to an active teacher (or the teacher is reactivated) — nothing destructive.
    const teacherIds = [...new Set(active.map((e) => e.teacherId).filter((t): t is string => !!t))];
    const inactiveTeachers = new Set<string>();
    if (teacherIds.length) {
      const rows = await this.db.db.query.staffMembers.findMany({
        where: and(inArray(staffMembers.id, teacherIds), ne(staffMembers.status, 'active')),
        columns: { id: true },
      });
      for (const r of rows) inactiveTeachers.add(r.id);
    }

    let created = 0, skippedExisting = 0, skippedConflicts = 0;
    for (const e of active) {
      const rule = e.scheduleRule as { weekday?: string; startTime?: string } | null;
      if (!rule?.weekday || !rule?.startTime) continue;
      if (e.teacherId && inactiveTeachers.has(e.teacherId)) continue;
      const r = await this.materializeEnrollment(e.organizationId, e.id);
      created += r.created; skippedExisting += r.skippedExisting; skippedConflicts += r.skippedConflicts;
    }
    return { created, skippedExisting, skippedConflicts };
  }

  async updateLesson(orgId: string, id: string, dto: UpdateLessonDto) {
    const existing = await this.getLesson(orgId, id);
    return this.db.db.transaction(async (tx) => {
      const tz = await this.getOrgTimezone(tx, orgId);
      const startsAt = dto.startsAt ? parseZonedDateTime(dto.startsAt, tz) : undefined;
      if (dto.startsAt || dto.teacherId) {
        const teacherId = dto.teacherId ?? existing.teacherId ?? undefined;
        await this.lockResources(tx, orgId, teacherId, existing.studentId);
        await this.checkConflicts(
          tx,
          orgId,
          (startsAt ?? existing.startsAt).toISOString(),
          dto.duration ?? existing.duration,
          teacherId,
          id,
          existing.studentId ?? undefined,
        );
      }
      const [updated] = await tx
        .update(lessons)
        .set({ ...dto, startsAt, updatedAt: new Date() })
        .where(and(eq(lessons.id, id), eq(lessons.organizationId, orgId)))
        .returning();
      return updated!;
    });
  }

  // Teachers may only act on their own lessons; receptionist+ may act on any lesson in the org.
  private async assertOwnsLesson(orgId: string, teacherId: string | null, actor?: Actor) {
    if (actor?.role !== 'teacher') return;
    const staffId = await this.resolveStaffId(orgId, actor.userId);
    if (!staffId || teacherId !== staffId) throw new ForbiddenException('Not your lesson');
  }

  async cancelLesson(orgId: string, id: string, dto: CancelLessonDto, actorUserId: string, actor?: Actor) {
    const lesson = await this.getLesson(orgId, id);
    await this.assertOwnsLesson(orgId, lesson.teacherId, actor);
    if (lesson.status !== 'scheduled') throw new BadRequestException('Lesson is not scheduled');

    const now = new Date();

    await this.db.db.update(lessons)
      .set({ status: dto.reason, cancelledAt: now, notes: dto.notes, updatedAt: now })
      .where(eq(lessons.id, id));

    // Best-effort: a failed notification must not fail the cancellation itself.
    await this.notifyCancelled(orgId, lesson).catch((e) =>
      this.logger.warn(`lesson.cancelled notify failed for ${id}: ${e}`),
    );

    return { id, status: dto.reason };
  }

  // Undo a cancellation — put a cancelled lesson back to 'scheduled'. Only for
  // lessons cancelled via cancelLesson (which just flips status). If attendance
  // was recorded, credits/charges were applied, so we refuse and send the user
  // to Attendance to reverse it there rather than silently leaving the books
  // inconsistent. Re-checks conflicts in case the slot was re-booked meanwhile.
  private static readonly REINSTATABLE = new Set([
    'cancelled_makeup', 'cancelled_no_makeup', 'cancelled_no_pay', 'cancelled_teacher',
  ]);

  async reinstateLesson(orgId: string, id: string, actor?: Actor) {
    const lesson = await this.getLesson(orgId, id);
    await this.assertOwnsLesson(orgId, lesson.teacherId, actor);
    if (!SchedulingService.REINSTATABLE.has(lesson.status)) {
      throw new BadRequestException('Only a cancelled lesson can be reinstated');
    }
    if (lesson.attendance) {
      throw new BadRequestException('This lesson has attendance recorded — reverse it from Attendance instead.');
    }

    return this.db.db.transaction(async (tx) => {
      const teacherId = lesson.teacherId ?? undefined;
      await this.lockResources(tx, orgId, teacherId, lesson.studentId);
      await this.checkConflicts(tx, orgId, lesson.startsAt.toISOString(), lesson.duration, teacherId, id, lesson.studentId ?? undefined);

      const [updated] = await tx.update(lessons)
        .set({ status: 'scheduled', cancelledAt: null, updatedAt: new Date() })
        .where(eq(lessons.id, id))
        .returning();
      return updated!;
    });
  }

  async directReschedule(orgId: string, id: string, newStartsAt: string, actor?: Actor) {
    const lesson = await this.getLesson(orgId, id);
    await this.assertOwnsLesson(orgId, lesson.teacherId, actor);
    // The authoritative guard: never move a settled lesson. A completed or
    // cancelled lesson is a historical record — moving it re-timetables a teacher
    // and leaves a dead-status lesson at a new time. Every caller (staff direct
    // move, reschedule-request approval, veto-review move) routes through here.
    if (!(RESCHEDULABLE_LESSON_STATUSES as readonly string[]).includes(lesson.status)) {
      throw new BadRequestException('Only a scheduled lesson can be rescheduled.');
    }

    return this.db.db.transaction(async (tx) => {
      const teacherId = lesson.teacherId ?? undefined;
      const tz = await this.getOrgTimezone(tx, orgId);
      // Interpret a naive wall-clock as studio-local; a zoned ISO passes through.
      const startsAt = parseZonedDateTime(newStartsAt, tz);
      const startsAtISO = startsAt.toISOString();
      await this.lockResources(tx, orgId, teacherId, lesson.studentId);
      await this.checkConflicts(tx, orgId, startsAtISO, lesson.duration, teacherId, id, lesson.studentId ?? undefined);

      // Reasonable-for-the-teacher check: the new slot must sit inside the
      // teacher's availability windows and not clash with their blocked time.
      const reason = await this.teacherUnavailableReason(tx, orgId, teacherId, startsAtISO, lesson.duration, tz);
      if (reason) throw new BadRequestException(reason);

      const [updated] = await tx
        .update(lessons)
        .set({ startsAt, updatedAt: new Date() })
        .where(eq(lessons.id, id))
        .returning();
      return updated!;
    }).then(async (updated) => {
      // Notify the family their lesson moved (best-effort, never blocks the reschedule).
      // Fires for BOTH the direct reschedule path and reschedule-request approval,
      // since decideRescheduleRequest routes through here.
      await this.notifyRescheduled(orgId, updated).catch((e) =>
        this.logger.warn(`lesson.rescheduled notify failed: ${e}`),
      );
      return updated;
    });
  }

  /**
   * The people to notify about a student's lesson: the family/guardian address
   * plus the student's own email when they have one (16+). Deduped. Cancellation
   * and reschedule notices are transactional, so — unlike marketing reminders —
   * they are NOT gated by the reminder-consent flag.
   */
  private async lessonNotifyRecipients(studentId: string): Promise<{ firstName: string | null; emails: string[] }> {
    const student = await this.db.db.query.students.findFirst({
      where: eq(students.id, studentId),
      columns: { firstName: true, email: true },
      with: { family: { columns: { email: true } } },
    });
    const emails = [...new Set(
      [student?.family?.email, student?.email]
        .map((e) => e?.trim().toLowerCase())
        .filter((e): e is string => !!e),
    )];
    // firstName is family-supplied and rendered as raw HTML in the notification
    // body, so escape it before it reaches an email. Self-targeted here (goes to
    // the family/student) but escaped for defence-in-depth and consistency.
    const firstName = student?.firstName
      ? student.firstName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      : null;
    return { firstName, emails };
  }

  /** Emails the student's family (and the student) that their lesson time changed. Best-effort. */
  private async notifyRescheduled(orgId: string, lesson: { studentId: string; startsAt: Date }) {
    const { firstName, emails } = await this.lessonNotifyRecipients(lesson.studentId);
    if (emails.length === 0) return;
    const tz = await this.getOrgTimezone(this.db.db, orgId);
    const when = formatInZone(new Date(lesson.startsAt), tz, {
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    });
    for (const email of emails) {
      await this.notifications.trigger('lesson.rescheduled', {
        orgId,
        email,
        body: `${firstName ?? 'Your child'}'s lesson is now on ${when}.`,
      });
    }
  }

  /** Emails the student's family (and the student) that a lesson was cancelled. Best-effort. */
  private async notifyCancelled(orgId: string, lesson: { studentId: string; startsAt: Date }) {
    const { firstName, emails } = await this.lessonNotifyRecipients(lesson.studentId);
    if (emails.length === 0) return;
    const tz = await this.getOrgTimezone(this.db.db, orgId);
    const when = formatInZone(new Date(lesson.startsAt), tz, {
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    });
    for (const email of emails) {
      await this.notifications.trigger('lesson.cancelled', {
        orgId,
        email,
        body: `${firstName ?? 'Your child'}'s lesson on ${when} has been cancelled.`,
      });
    }
  }

  /** Emails the family once that a whole recurring series was cancelled. Best-effort. */
  private async notifyRecurringCancelled(orgId: string, studentId: string) {
    const { firstName, emails } = await this.lessonNotifyRecipients(studentId);
    if (emails.length === 0) return;
    for (const email of emails) {
      await this.notifications.trigger('lesson.cancelled', {
        orgId,
        email,
        body: `${firstName ?? 'Your child'}'s recurring weekly lessons have been cancelled by the teacher. There's no charge — please book a new time if you'd like to continue.`,
      });
    }
  }

  /** Emails the family once that their recurring weekly time changed. Best-effort. */
  private async notifyRecurringMoved(orgId: string, studentId: string, newStartsAt: Date) {
    const { firstName, emails } = await this.lessonNotifyRecipients(studentId);
    if (emails.length === 0) return;
    const tz = await this.getOrgTimezone(this.db.db, orgId);
    const when = formatInZone(new Date(newStartsAt), tz, {
      weekday: 'long', hour: '2-digit', minute: '2-digit',
    });
    for (const email of emails) {
      await this.notifications.trigger('lesson.rescheduled', {
        orgId,
        email,
        body: `${firstName ?? 'Your child'}'s weekly lesson has moved to ${when} each week.`,
      });
    }
  }

  // ─── Teacher availability ───────────────────────────────────────────────────
  private async getOrgTimezone(exec: Executor, orgId: string): Promise<string> {
    const org = await exec.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
      columns: { timezone: true },
    });
    return org?.timezone ?? 'Europe/London';
  }

  private static readonly WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

  // Longest a single lesson can run (enrollment/staff defaultDuration caps). Used
  // to size the conflict-check lookback window so a long earlier lesson is never
  // pruned out of the overlap candidate set.
  private static readonly MAX_LESSON_MINUTES = 600;

  /** Wall-clock weekday + minutes-since-midnight for an absolute instant, in the studio's timezone. */
  private localParts(date: Date, timeZone: string): { weekday: string; minutes: number } {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone, weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    let hour = parseInt(get('hour'), 10);
    if (hour === 24) hour = 0; // some engines render midnight as 24
    return { weekday: get('weekday').toLowerCase(), minutes: hour * 60 + parseInt(get('minute'), 10) };
  }

  /**
   * Returns a human-readable reason if the teacher is NOT available for a lesson
   * at `startsAtISO` (blocked time clash, or outside their availability windows),
   * or null if the slot is fine. If the teacher has set no availability windows
   * at all, only blocked time is enforced (we don't lock out teachers who simply
   * haven't filled in their hours yet).
   */
  async teacherUnavailableReason(
    exec: Executor,
    orgId: string,
    teacherId: string | undefined,
    startsAtISO: string,
    duration: number,
    timeZone: string,
  ): Promise<string | null> {
    const start = new Date(startsAtISO);
    const end = new Date(start.getTime() + duration * 60000);

    // A slot in the past is never bookable — you can't confirm, counter, or
    // reschedule a lesson onto a time that has already happened. createLessonRequest
    // guards the proposal, but a request made days ago can name a time that has
    // since passed; without this, confirming it would create a past-dated lesson.
    // This is the shared chokepoint for both display (ok:false, button disabled)
    // and the confirm/counter/approve writes, so the guard lives here once.
    if (start.getTime() <= Date.now()) {
      return 'That time has already passed. Please pick a time in the future.';
    }

    if (!teacherId) return null;

    const blocks = await exec.query.blockedTime.findMany({
      where: and(eq(blockedTime.organizationId, orgId), eq(blockedTime.staffId, teacherId)),
    });
    if (blocks.some((b) => b.startsAt < end && b.endsAt > start)) {
      return 'The teacher has blocked time at that slot. Please pick another time.';
    }

    const windows = await exec.query.availability.findMany({
      where: and(eq(availability.organizationId, orgId), eq(availability.staffId, teacherId)),
    });
    if (windows.length === 0) return null; // no availability set → don't block

    const { weekday, minutes: startMin } = this.localParts(start, timeZone);
    const endMin = this.localParts(end, timeZone).minutes;
    const toMin = (t: string) => { const [h, m] = t.split(':'); return parseInt(h!, 10) * 60 + parseInt(m ?? '0', 10); };
    const dayWindows = windows.filter((w) => w.weekday === weekday);
    if (dayWindows.length === 0) {
      return `The teacher isn't available on ${weekday[0]!.toUpperCase()}${weekday.slice(1)}s. Please pick another day.`;
    }
    const fits = dayWindows.some((w) => startMin >= toMin(w.startTime) && endMin <= toMin(w.endTime));
    if (!fits) {
      const hours = dayWindows.map((w) => `${w.startTime}–${w.endTime}`).join(', ');
      return `That time is outside the teacher's hours (${hours}). Please pick a time within their availability.`;
    }
    return null;
  }

  /**
   * Bookable start times for a teacher on a studio-local `date`, in 15-minute
   * increments — a slot is offered only when the whole [start, start+duration]
   * window fits inside one of the teacher's availability windows for that weekday
   * AND is free of existing lessons and blocked time. This is what makes "add
   * lesson" respect a teacher's working hours instead of accepting any time.
   *
   * If the teacher has set no availability windows, we don't lock booking out
   * (mirrors teacherUnavailableReason): we return the full working-day grid and
   * flag `noWindows` so the UI can nudge them to set hours.
   */
  async getAvailableSlots(
    orgId: string, teacherId: string, date: string, duration = 60,
  ): Promise<{ date: string; weekday: string; noWindows: boolean; slots: string[] }> {
    // A missing/malformed date has no `@Query()` DTO to catch it (this endpoint
    // takes raw query params), so it fell through to `new Date(...).getUTCDay()`
    // returning NaN, which then hit the weekday enum column as an invalid value
    // and 500'd at the DB layer instead of failing cleanly here.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T12:00:00Z`).getTime())) {
      throw new BadRequestException('date must be a valid YYYY-MM-DD date');
    }
    const tz = await this.getOrgTimezone(this.db.db, orgId);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    const weekday = SchedulingService.WEEKDAYS[dow]!;
    const toMin = (t: string) => { const [h, m] = t.split(':'); return parseInt(h!, 10) * 60 + parseInt(m ?? '0', 10); };

    const windows = await this.db.db.query.availability.findMany({
      where: and(eq(availability.organizationId, orgId), eq(availability.staffId, teacherId), eq(availability.weekday, weekday)),
    });
    const noWindows = (await this.db.db.query.availability.findMany({
      where: and(eq(availability.organizationId, orgId), eq(availability.staffId, teacherId)),
      columns: { id: true },
    })).length === 0;

    // Ranges (in minutes since midnight) to draw candidate starts from.
    const ranges: [number, number][] = noWindows
      ? [[8 * 60, 21 * 60]]                                    // fallback: full working day
      : windows.map((w) => [toMin(w.startTime), toMin(w.endTime)] as [number, number]);
    if (ranges.length === 0) return { date, weekday, noWindows, slots: [] };

    // Pull the teacher's day once so overlap checks are in-memory, not per-slot queries.
    const dayStart = parseZonedDateTime(`${date}T00:00:00`, tz);
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
    const [dayLessons, blocks] = await Promise.all([
      this.db.db.query.lessons.findMany({
        where: and(
          eq(lessons.organizationId, orgId),
          eq(lessons.teacherId, teacherId),
          eq(lessons.status, 'scheduled'),
          gte(lessons.startsAt, new Date(dayStart.getTime() - 4 * 3600 * 1000)),
          lte(lessons.startsAt, dayEnd),
        ),
        columns: { startsAt: true, duration: true },
      }),
      this.db.db.query.blockedTime.findMany({
        where: and(eq(blockedTime.organizationId, orgId), eq(blockedTime.staffId, teacherId)),
        columns: { startsAt: true, endsAt: true },
      }),
    ]);

    const slots: string[] = [];
    const seen = new Set<string>();
    for (const [rStart, rEnd] of ranges) {
      for (let m = rStart; m + duration <= rEnd; m += 15) {
        const hh = String(Math.floor(m / 60)).padStart(2, '0');
        const mm = String(m % 60).padStart(2, '0');
        const label = `${hh}:${mm}`;
        if (seen.has(label)) continue;
        const start = parseZonedDateTime(`${date}T${label}:00`, tz);
        const end = new Date(start.getTime() + duration * 60000);
        const clashesLesson = dayLessons.some((l) => {
          const lEnd = new Date(l.startsAt.getTime() + l.duration * 60000);
          return l.startsAt < end && lEnd > start;
        });
        const clashesBlock = blocks.some((b) => b.startsAt < end && b.endsAt > start);
        if (!clashesLesson && !clashesBlock) { slots.push(label); seen.add(label); }
      }
    }
    slots.sort();
    return { date, weekday, noWindows, slots };
  }

  /**
   * Bookable slots for a teacher across the 7 studio-local days starting at
   * `weekStart` (a date string), returned as concrete zoned instants. Reuses
   * getAvailableSlots per day so parent booking and the staff calendar share one
   * timezone-correct, 15-minute, conflict-aware engine. `futureOnly` drops slots
   * already in the past (for the parent picker).
   */
  async getAvailableSlotsWeek(
    orgId: string, teacherId: string, weekStart: string, duration = 60,
    opts?: { futureOnly?: boolean },
  ): Promise<{ startsAt: string; endsAt: string }[]> {
    const tz = await this.getOrgTimezone(this.db.db, orgId);
    const now = new Date();
    // Anchor at UTC midnight so stepping by whole days keeps the date label stable.
    const base = new Date(`${weekStart.slice(0, 10)}T00:00:00Z`);
    const out: { startsAt: string; endsAt: string }[] = [];
    for (let d = 0; d < 7; d++) {
      const dateStr = new Date(base.getTime() + d * 86400000).toISOString().slice(0, 10);
      const { slots } = await this.getAvailableSlots(orgId, teacherId, dateStr, duration);
      for (const hhmm of slots) {
        const startsAt = parseZonedDateTime(`${dateStr}T${hhmm}:00`, tz);
        if (opts?.futureOnly && startsAt <= now) continue;
        out.push({
          startsAt: startsAt.toISOString(),
          endsAt: new Date(startsAt.getTime() + duration * 60000).toISOString(),
        });
      }
    }
    return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  // ─── Lesson requests (front desk proposes ranked times, teacher confirms) ────
  /**
   * The front desk (receptionist+) proposes up to three ranked start times for a
   * new lesson; the assigned teacher confirms whichever suits. No lesson exists
   * until the teacher confirms — this is the "teacher ultimately chooses the time"
   * flow, the new-booking sibling of reschedule requests.
   */
  async createLessonRequest(orgId: string, dto: CreateLessonRequestDto, requestedBy: string) {
    const tz = await this.getOrgTimezone(this.db.db, orgId);

    // Validate the referenced student and teacher exist in this org BEFORE
    // inserting — otherwise a bad id hit the foreign-key constraint and surfaced
    // as an unhandled 500 instead of a clean 404.
    const student = await this.db.db.query.students.findFirst({
      where: and(eq(students.id, dto.studentId), eq(students.organizationId, orgId)),
    });
    if (!student) throw new NotFoundException('Student not found');
    const teacher = await this.db.db.query.staffMembers.findFirst({
      where: and(eq(staffMembers.id, dto.teacherId), eq(staffMembers.organizationId, orgId)),
    });
    if (!teacher) throw new NotFoundException('Teacher not found');

    // A lesson request is a proposal for a FUTURE lesson — reject times in the
    // past so a stale/mistyped date can't create a request (or, once confirmed,
    // a lesson) on a day that has already happened.
    const proposed = parseZonedDateTime(dto.proposedStartsAt, tz);
    if (proposed.getTime() <= Date.now()) {
      throw new BadRequestException('The proposed time must be in the future.');
    }

    const [req] = await this.db.db.insert(lessonRequests).values({
      organizationId: orgId,
      studentId: dto.studentId,
      teacherId: dto.teacherId,
      enrollmentId: dto.enrollmentId,
      duration: dto.duration ?? 60,
      proposedStartsAt: proposed,
      proposedStartsAt2: dto.proposedStartsAt2 ? parseZonedDateTime(dto.proposedStartsAt2, tz) : undefined,
      proposedStartsAt3: dto.proposedStartsAt3 ? parseZonedDateTime(dto.proposedStartsAt3, tz) : undefined,
      notes: dto.notes,
      requestedBy,
      status: 'pending',
    }).returning();
    return req!;
  }

  // A family self-booking books its 1st choice this many hours ahead at the
  // earliest, so the teacher always has room to move or decline before it runs.
  private static readonly FAMILY_BOOKING_LEAD_HOURS = 48;

  /**
   * A family self-books from the calendar. Unlike the front-desk lesson request
   * (which creates nothing until a teacher confirms a time), this books the
   * family's 1st-choice time IMMEDIATELY — so they leave with a confirmed lesson
   * — while recording the 2nd/3rd choices and opening an 'auto_confirmed' request
   * the teacher can Accept, Move (to a recorded alternative) or Decline. The
   * caller (family-portal) has already checked the student, enrolment and teacher
   * belong to this family.
   */
  async createFamilyBooking(
    orgId: string,
    dto: {
      studentId: string; teacherId: string; enrollmentId: string; termId?: string;
      startsAt: string; startsAt2?: string; startsAt3?: string;
      duration: number; isTrialLesson?: boolean; recurring?: boolean; recurringEndDate?: string; notes?: string;
    },
    requestedBy: string,
  ) {
    const tz = await this.getOrgTimezone(this.db.db, orgId);
    const ranked = [dto.startsAt, dto.startsAt2, dto.startsAt3]
      .filter((s): s is string => !!s)
      .map((s) => parseZonedDateTime(s, tz));
    if (ranked.length === 0) throw new BadRequestException('Pick at least one time.');

    const leadMs = SchedulingService.FAMILY_BOOKING_LEAD_HOURS * 3600000;
    if (ranked[0]!.getTime() - Date.now() < leadMs) {
      throw new BadRequestException(
        `Lessons booked online must be at least ${SchedulingService.FAMILY_BOOKING_LEAD_HOURS} hours ahead. For anything sooner, please contact the studio.`,
      );
    }

    // Group classes meet at a fixed shared time — they aren't self-bookable as
    // individual slots. Guard the API even though the picker hides them, so a
    // stale client or a crafted request can't turn a group enrolment into a 1:1.
    const enrollment = await this.db.db.query.enrollments.findFirst({
      where: and(eq(enrollments.id, dto.enrollmentId), eq(enrollments.organizationId, orgId)),
      columns: { lessonType: true, status: true },
    });
    if (!enrollment) throw new BadRequestException('Enrolment not found.');
    // Only a live enrolment is self-bookable. A withdrawn enrolment was
    // deliberately ended by the studio — withdraw tears down its recurrence and
    // cancels its future lessons (enrollment withdraw teardown) — and a paused
    // one is temporarily halted. Self-booking against either (via a stale picker
    // that still lists it, or a crafted request) would create a fresh lesson,
    // re-timetable the teacher, and bill the family for an instrument they no
    // longer take, undoing the teardown. Same "guard the API even though the
    // picker hides it" reasoning as the group check below.
    if (enrollment.status !== 'active' && enrollment.status !== 'trial') {
      throw new BadRequestException('This enrolment is not currently active, so it can’t be booked online. Please contact the studio.');
    }
    if (enrollment.lessonType === 'group') {
      throw new BadRequestException('Group classes are arranged by the studio, not booked online. Please contact us to join a group.');
    }

    // The teacher must still be active. A departed teacher is deactivated
    // (staffMembers.status='inactive'); the recurrence worker already refuses to
    // generate their lessons (recurrence-skips-inactive-teacher). But an enrolment
    // whose teacherId still points at that teacher stays 'active', so a family can
    // reach this path — via a stale picker or a crafted request — and self-book a
    // fresh one-off onto a teacher who has left: it lands on their timetable and
    // pays them at payroll for a studio they no longer work for. The picker
    // (getTeachers) already filters to active staff; guard the API to match, same
    // reasoning as the enrolment checks above.
    const teacher = await this.db.db.query.staffMembers.findFirst({
      where: and(eq(staffMembers.id, dto.teacherId), eq(staffMembers.organizationId, orgId)),
      columns: { status: true },
    });
    if (!teacher) throw new NotFoundException('Teacher not found.');
    if (teacher.status !== 'active') {
      throw new BadRequestException('That teacher is no longer taking online bookings. Please contact the studio to be reassigned.');
    }

    // Instant-book the 1st choice — runs the shared advisory lock + conflict
    // checks, so self-service can't double-book a teacher.
    const lesson = await this.createLesson(orgId, {
      studentId: dto.studentId,
      teacherId: dto.teacherId,
      enrollmentId: dto.enrollmentId,
      termId: dto.termId,
      startsAt: ranked[0]!.toISOString(),
      duration: dto.duration,
      isTrialLesson: dto.isTrialLesson ?? false,
      notes: dto.notes,
    }, { notify: false }); // the caller (bookLesson) sends its own richer confirmation email

    // Recording a recurring rule switches on the nightly generator for this
    // enrolment; materialise the near-term window now so the series shows up
    // immediately, not only after the 2 AM top-up.
    if (dto.recurring) {
      // An end date (if given) must be after the first lesson, else the series
      // would generate nothing — reject rather than silently book an empty run.
      if (dto.recurringEndDate) {
        const endCap = parseZonedDateTime(`${dto.recurringEndDate}T23:59:59`, tz);
        if (endCap.getTime() < ranked[0]!.getTime()) {
          throw new BadRequestException('The end date must be on or after the first lesson.');
        }
      }
      const rule = { ...zonedWeekdayAndTime(ranked[0]!, tz), endDate: dto.recurringEndDate };
      await this.db.db.update(enrollments)
        .set({ scheduleRule: rule, updatedAt: new Date() })
        .where(and(eq(enrollments.id, dto.enrollmentId), eq(enrollments.organizationId, orgId)));
      // Generate the series starting from the first booked lesson, NOT from now.
      // The family's 1st choice can be a week out precisely because this week's
      // slot fell inside the 48h lead window; materialising from now would emit
      // that nearer (<48h) occurrence too — an extra lesson they never booked
      // that then bills them. Anchoring at ranked[0] keeps the series to the
      // times the family actually chose.
      await this.materializeEnrollment(orgId, dto.enrollmentId, { fromDate: ranked[0]!.toISOString() }).catch((e) =>
        this.logger.warn(`materialize after recurring family booking failed: ${e}`),
      );
    }

    const [req] = await this.db.db.insert(lessonRequests).values({
      organizationId: orgId,
      studentId: dto.studentId,
      teacherId: dto.teacherId,
      enrollmentId: dto.enrollmentId,
      duration: dto.duration,
      proposedStartsAt: ranked[0]!,
      proposedStartsAt2: ranked[1],
      proposedStartsAt3: ranked[2],
      status: 'auto_confirmed',
      isRecurring: dto.recurring ?? false,
      createdLessonId: lesson.id,
      requestedBy,
      notes: dto.notes,
    }).returning();

    return { lesson, request: req! };
  }

  /**
   * Accept / Move / Decline a family auto-booking. The lesson already exists
   * (createdLessonId), so — unlike a front-desk request — we act on it in place
   * rather than creating a second one.
   */
  private async decideAutoBooking(
    orgId: string,
    req: typeof lessonRequests.$inferSelect,
    decision: 'confirmed' | 'declined',
    actor: Actor,
    chosenStartsAt?: string,
    reason?: string,
  ) {
    const lessonId = req.createdLessonId;
    if (!lessonId) throw new BadRequestException('This booking has no lesson to act on');

    // The family may have cancelled or moved this lesson between booking it and the
    // teacher reviewing. Acting on a non-scheduled lesson would either no-op an
    // "Accept" onto a dead lesson or reschedule a cancelled one, so treat the
    // review as moot: resolve the request and take it out of the queue.
    const existingLesson = await this.getLesson(orgId, lessonId).catch(() => null);
    if (!existingLesson || existingLesson.status !== 'scheduled') {
      await this.db.db.update(lessonRequests)
        .set({ status: 'declined', decidedBy: actor.userId, decidedAt: new Date(), reason: 'Lesson no longer active' })
        .where(and(
          eq(lessonRequests.id, req.id),
          eq(lessonRequests.organizationId, orgId),
          eq(lessonRequests.status, 'auto_confirmed'),
        ));
      throw new BadRequestException('This lesson was already changed or cancelled by the family, so there’s nothing to review. It has been cleared from your list.');
    }

    // Atomically claim the review so a double-tap or two-teacher race resolves once.
    const claimed = await this.db.db.update(lessonRequests)
      .set({ status: decision, decidedBy: actor.userId, decidedAt: new Date(), reason })
      .where(and(
        eq(lessonRequests.id, req.id),
        eq(lessonRequests.organizationId, orgId),
        eq(lessonRequests.status, 'auto_confirmed'),
      ))
      .returning({ id: lessonRequests.id });
    if (claimed.length === 0) throw new BadRequestException('This booking has already been reviewed');

    try {
      if (decision === 'declined') {
        // cancelled_teacher = no charge, no credit lost, teacher not paid; also
        // notifies the family. NOT the family-cancel path (which can charge).
        await this.cancelLesson(orgId, lessonId, { reason: 'cancelled_teacher', notes: reason }, actor.userId, actor);
        // Declining a recurring booking stops the whole series, not just this
        // occurrence. Booking already materialised the near-term window (up to
        // RECURRENCE_WINDOW_WEEKS of real rows), so nulling the rule alone would
        // strand weeks 2-N on everyone's calendar — cancel every future
        // occurrence of this enrolment too, on the same no-charge teacher path.
        if (req.isRecurring && req.enrollmentId) {
          await this.db.db.update(enrollments)
            .set({ scheduleRule: null, updatedAt: new Date() })
            .where(and(eq(enrollments.id, req.enrollmentId), eq(enrollments.organizationId, orgId)));

          const now = new Date();
          const future = await this.db.db.query.lessons.findMany({
            where: and(
              eq(lessons.enrollmentId, req.enrollmentId),
              eq(lessons.organizationId, orgId),
              eq(lessons.status, 'scheduled'),
              gte(lessons.startsAt, now),
            ),
            columns: { id: true, studentId: true, startsAt: true },
          });
          if (future.length) {
            await this.db.db.update(lessons)
              .set({ status: 'cancelled_teacher', cancelledAt: now, notes: reason, updatedAt: now })
              .where(and(
                eq(lessons.enrollmentId, req.enrollmentId),
                eq(lessons.organizationId, orgId),
                eq(lessons.status, 'scheduled'),
                gte(lessons.startsAt, now),
              ));
            // One notice for the series, not one email per week.
            await this.notifyRecurringCancelled(orgId, future[0]!.studentId).catch((e) =>
              this.logger.warn(`recurring cancel notify failed for enrollment ${req.enrollmentId}: ${e}`),
            );
          }
        }
        return { id: req.id, status: 'declined' as const, lessonId };
      }

      // Confirmed: keep #1 (Accept) or move to one of the family's other ranked
      // times (Move). A time that wasn't offered is rejected.
      const ranked = [req.proposedStartsAt, req.proposedStartsAt2, req.proposedStartsAt3]
        .filter(Boolean).map((d) => (d as Date).toISOString());
      const target = chosenStartsAt ? new Date(chosenStartsAt).toISOString() : ranked[0]!;
      if (!ranked.includes(target)) {
        throw new BadRequestException('Chosen time is not one of the family’s proposed options');
      }
      if (target !== req.proposedStartsAt.toISOString()) {
        // Move the booked lesson: re-checks conflicts + availability and notifies the family.
        await this.directReschedule(orgId, lessonId, target, actor);
      }
      return { id: req.id, status: 'confirmed' as const, lessonId };
    } catch (err) {
      // The side effect failed (e.g. the alternative slot is no longer free).
      // Put the review back to 'auto_confirmed' so it isn't stranded as decided
      // with nothing having happened.
      await this.db.db.update(lessonRequests)
        .set({ status: 'auto_confirmed', decidedBy: null, decidedAt: null })
        .where(eq(lessonRequests.id, req.id));
      throw err;
    }
  }

  /**
   * Teacher-driven move of a whole recurring series to a different weekly time.
   * A series has no family back-ups to move to, so the teacher picks a new weekly
   * slot. Consistent with the one-off "Move to back-up" (teacher has authority,
   * family is notified by email), there is no separate family confirmation step —
   * families have no in-app request feed yet.
   */
  async moveRecurringSeries(orgId: string, id: string, newStartsAt: string, actor: Actor) {
    const req = await this.db.db.query.lessonRequests.findFirst({
      where: and(eq(lessonRequests.id, id), eq(lessonRequests.organizationId, orgId)),
    });
    if (!req) throw new NotFoundException('Request not found');
    if (actor.role === 'teacher') {
      const staffId = await this.resolveStaffId(orgId, actor.userId);
      if (!staffId || req.teacherId !== staffId) throw new ForbiddenException('Not your request');
    }
    if (req.status !== 'auto_confirmed' || !req.isRecurring || !req.enrollmentId) {
      throw new BadRequestException('Only a recurring booking can be moved to a new weekly time.');
    }

    const tz = await this.getOrgTimezone(this.db.db, orgId);
    const target = parseZonedDateTime(newStartsAt, tz);
    const targetISO = target.toISOString();

    // The new weekly slot must sit in the teacher's hours and not clash.
    const unavailable = await this.teacherUnavailableReason(this.db.db, orgId, req.teacherId, targetISO, req.duration, tz);
    if (unavailable) throw new BadRequestException(unavailable);
    if (await this.hasConflict(this.db.db, orgId, targetISO, req.duration, req.teacherId, undefined, req.studentId)) {
      throw new BadRequestException('That weekly time clashes with another lesson.');
    }

    // Keep any end date the family set when they created the series.
    const enrollment = await this.db.db.query.enrollments.findFirst({
      where: and(eq(enrollments.id, req.enrollmentId), eq(enrollments.organizationId, orgId)),
      columns: { scheduleRule: true },
    });
    const endDate = (enrollment?.scheduleRule as { endDate?: string } | null)?.endDate;

    // Claim the review so a double-tap / two-teacher race resolves once.
    const claimed = await this.db.db.update(lessonRequests)
      .set({ status: 'confirmed', decidedBy: actor.userId, decidedAt: new Date(), proposedStartsAt: target })
      .where(and(
        eq(lessonRequests.id, id),
        eq(lessonRequests.organizationId, orgId),
        eq(lessonRequests.status, 'auto_confirmed'),
      ))
      .returning({ id: lessonRequests.id });
    if (claimed.length === 0) throw new BadRequestException('This booking has already been reviewed.');

    try {
      // Drop the old future occurrences, retarget the weekly rule (preserving the
      // end date), and regenerate the series at the new time.
      const now = new Date();
      await this.db.db.update(lessons)
        .set({ status: 'cancelled_teacher', cancelledAt: now, updatedAt: now })
        .where(and(
          eq(lessons.enrollmentId, req.enrollmentId),
          eq(lessons.organizationId, orgId),
          eq(lessons.status, 'scheduled'),
          gte(lessons.startsAt, now),
        ));

      const rule = { ...zonedWeekdayAndTime(target, tz), endDate };
      await this.db.db.update(enrollments)
        .set({ scheduleRule: rule, updatedAt: new Date() })
        .where(and(eq(enrollments.id, req.enrollmentId), eq(enrollments.organizationId, orgId)));
      // Anchor regeneration at the teacher's chosen new time, not now, so an
      // earlier same-weekday slot still ahead this week isn't back-filled as a
      // surprise lesson (see createFamilyBooking for the same reasoning).
      await this.materializeEnrollment(orgId, req.enrollmentId, { fromDate: target.toISOString() });

      await this.notifyRecurringMoved(orgId, req.studentId, target).catch((e) =>
        this.logger.warn(`recurring move notify failed for enrollment ${req.enrollmentId}: ${e}`),
      );
      return { id: req.id, status: 'confirmed' as const };
    } catch (err) {
      await this.db.db.update(lessonRequests)
        .set({ status: 'auto_confirmed', decidedBy: null, decidedAt: null, proposedStartsAt: req.proposedStartsAt })
        .where(eq(lessonRequests.id, req.id));
      throw err;
    }
  }

  async getLessonRequests(orgId: string, actor: Actor, status?: string) {
    const teacherStaffId = actor.role === 'teacher' ? await this.resolveStaffId(orgId, actor.userId) : null;

    const rows = await this.db.db.query.lessonRequests.findMany({
      // "pending" means "still open", which now includes requests the teacher has
      // countered — those are waiting on the front desk, not finished. Filtering
      // strictly on 'pending' would make a countered request vanish from both
      // queues and strand the family.
      where: status
        ? and(
            eq(lessonRequests.organizationId, orgId),
            status === 'pending'
              ? inArray(lessonRequests.status, ['pending', 'counter_proposed', 'auto_confirmed'])
              : eq(lessonRequests.status, status as 'confirmed' | 'declined'),
          )
        : eq(lessonRequests.organizationId, orgId),
      with: {
        student: { columns: { id: true, firstName: true, lastName: true } },
        teacher: { columns: { id: true, firstName: true, lastName: true } },
        enrollment: { columns: { instrument: true, lessonType: true, groupName: true } },
        requestedByUser: { columns: { id: true, email: true } },
      },
      orderBy: (r, { desc }) => [desc(r.createdAt)],
    });

    // Teachers only ever see (and can act on) requests addressed to them.
    const scoped = actor.role === 'teacher' ? rows.filter((r) => r.teacherId === teacherStaffId) : rows;

    const tz = await this.getOrgTimezone(this.db.db, orgId);
    return Promise.all(scoped.map(async (r) => {
      // Once the teacher has countered, their times are the live options — the
      // front desk confirms one of those, not the originals.
      const ranked = (r.status === 'counter_proposed'
        ? [r.counterStartsAt, r.counterStartsAt2, r.counterStartsAt3]
        : [r.proposedStartsAt, r.proposedStartsAt2, r.proposedStartsAt3]).filter(Boolean) as Date[];
      const options = await Promise.all(ranked.map(async (t, i) => {
        const iso = t.toISOString();
        const unavailable = await this.teacherUnavailableReason(this.db.db, orgId, r.teacherId, iso, r.duration, tz);
        // Exclude the request's own instant-booked lesson (auto_confirmed) so its
        // 1st choice doesn't read as clashing with itself.
        const conflict = unavailable ? false : await this.hasConflict(this.db.db, orgId, iso, r.duration, r.teacherId, r.createdLessonId ?? undefined, r.studentId);
        return {
          rank: i + 1,
          startsAt: iso,
          ok: !unavailable && !conflict,
          reason: unavailable ?? (conflict ? 'Clashes with another lesson at that time.' : null),
        };
      }));
      return { ...r, options };
    }));
  }

  /**
   * The teacher offers times of their own instead of accepting or killing the
   * request.
   *
   * Every proposed slot clashing is the normal case, not an edge case — the
   * front desk is guessing at a teacher's diary. Before this, "Decline" was the
   * only enabled button and the family had to start over with no idea what
   * would actually work.
   *
   * Counter times are validated exactly as a confirmation would be, so a teacher
   * can't offer a slot they aren't free for.
   */
  async counterProposeLessonRequest(
    orgId: string, id: string, actor: Actor, times: string[], reason?: string,
  ) {
    const req = await this.db.db.query.lessonRequests.findFirst({
      where: and(eq(lessonRequests.id, id), eq(lessonRequests.organizationId, orgId)),
    });
    if (!req) throw new NotFoundException('Request not found');
    if (req.status !== 'pending' && req.status !== 'counter_proposed') {
      throw new BadRequestException('Request already decided');
    }
    if (actor.role === 'teacher') {
      const staffId = await this.resolveStaffId(orgId, actor.userId);
      if (!staffId || req.teacherId !== staffId) throw new ForbiddenException('Not your request');
    }
    if (!times.length) throw new BadRequestException('Suggest at least one time');

    const tz = await this.getOrgTimezone(this.db.db, orgId);
    const iso: string[] = [];
    for (const t of times.slice(0, 3)) {
      const target = new Date(t).toISOString();
      const unavailable = await this.teacherUnavailableReason(this.db.db, orgId, req.teacherId, target, req.duration, tz);
      if (unavailable) throw new BadRequestException(unavailable);
      if (await this.hasConflict(this.db.db, orgId, target, req.duration, req.teacherId, undefined, req.studentId)) {
        throw new BadRequestException('One of your suggested times clashes with another lesson.');
      }
      iso.push(target);
    }

    const openStatus = req.status;
    const claimed = await this.db.db.update(lessonRequests)
      .set({
        status: 'counter_proposed',
        counterStartsAt: new Date(iso[0]!),
        counterStartsAt2: iso[1] ? new Date(iso[1]) : null,
        counterStartsAt3: iso[2] ? new Date(iso[2]) : null,
        reason: reason ?? req.reason,
      })
      .where(and(
        eq(lessonRequests.id, id),
        eq(lessonRequests.organizationId, orgId),
        eq(lessonRequests.status, openStatus),
      ))
      .returning();
    if (claimed.length === 0) throw new BadRequestException('Request already decided');
    return claimed[0]!;
  }

  async decideLessonRequest(
    orgId: string, id: string, decision: 'confirmed' | 'declined',
    actor: Actor, chosenStartsAt?: string, reason?: string,
  ) {
    const req = await this.db.db.query.lessonRequests.findFirst({
      where: and(eq(lessonRequests.id, id), eq(lessonRequests.organizationId, orgId)),
    });
    if (!req) throw new NotFoundException('Request not found');

    // A teacher may only decide their own requests; receptionist+ may decide any.
    if (actor.role === 'teacher') {
      const staffId = await this.resolveStaffId(orgId, actor.userId);
      if (!staffId || req.teacherId !== staffId) throw new ForbiddenException('Not your request');
    }

    // A family auto-booking already created the lesson: Accept / Move / Decline
    // it in place instead of creating a second one.
    if (req.status === 'auto_confirmed') {
      return this.decideAutoBooking(orgId, req, decision, actor, chosenStartsAt, reason);
    }

    // A counter-proposal is still live — it's awaiting the front desk, not decided.
    if (req.status !== 'pending' && req.status !== 'counter_proposed') {
      throw new BadRequestException('Request already decided');
    }

    let target: string | undefined;
    if (decision === 'confirmed') {
      // Once the teacher has countered, their times are the ones on the table.
      const ranked = [
        req.proposedStartsAt, req.proposedStartsAt2, req.proposedStartsAt3,
        req.counterStartsAt, req.counterStartsAt2, req.counterStartsAt3,
      ].filter(Boolean).map((d) => (d as Date).toISOString());
      target = chosenStartsAt ? new Date(chosenStartsAt).toISOString() : ranked[0]!;
      if (chosenStartsAt && !ranked.includes(target)) {
        throw new BadRequestException('Chosen time is not one of the proposed options');
      }
      const tz = await this.getOrgTimezone(this.db.db, orgId);
      const unavailable = await this.teacherUnavailableReason(this.db.db, orgId, req.teacherId, target, req.duration, tz);
      if (unavailable) throw new BadRequestException(unavailable);
      // Include the student in the pre-check, matching createLesson's own conflict
      // check (below). Otherwise confirming this request into a slot where the
      // student is already booked passes here, the request is claimed 'confirmed'
      // (committed just below), then createLesson throws the student clash — leaving
      // the request stuck 'confirmed' with no lesson created and no way to re-decide.
      if (await this.hasConflict(this.db.db, orgId, target, req.duration, req.teacherId, undefined, req.studentId ?? undefined)) {
        throw new BadRequestException('That time clashes with another lesson.');
      }
    }

    // Guarded claim: only the first decider transitions it out of the open state.
    const openStatus = req.status;
    const claimed = await this.db.db.update(lessonRequests)
      .set({ status: decision, decidedBy: actor.userId, decidedAt: new Date(), reason })
      .where(and(
        eq(lessonRequests.id, id),
        eq(lessonRequests.organizationId, orgId),
        eq(lessonRequests.status, openStatus),
      ))
      .returning({ id: lessonRequests.id });
    if (claimed.length === 0) throw new BadRequestException('Request already decided');

    if (decision === 'confirmed' && target) {
      // target is a zoned ISO instant; createLesson re-parses it (a Z-suffixed
      // string round-trips) and re-checks conflicts under a lock.
      const lesson = await this.createLesson(orgId, {
        studentId: req.studentId,
        teacherId: req.teacherId,
        enrollmentId: req.enrollmentId ?? undefined,
        startsAt: target,
        duration: req.duration,
        notes: req.notes ?? undefined,
      });
      await this.db.db.update(lessonRequests)
        .set({ createdLessonId: lesson.id })
        .where(eq(lessonRequests.id, id));
      return { id, status: decision, lessonId: lesson.id };
    }

    return { id, status: decision };
  }

  // ─── Reschedule requests ──────────────────────────────────────────────────
  async createRescheduleRequest(orgId: string, dto: CreateRescheduleRequestDto, actor: Actor) {
    // Pass the actor so teachers are scoped to their own lessons inside getLesson.
    const lesson = await this.getLesson(orgId, dto.lessonId, actor);

    // Family callers (guardian/student) may only reschedule lessons belonging to
    // their OWN family — otherwise anyone could submit reschedule requests against
    // another family's lessons (the request is only scoped by org). 404, not 403,
    // so we don't confirm the lesson exists. Staff (receptionist+) are unrestricted.
    //
    // A GUARDIAN covers the whole family; a logged-in STUDENT is scoped to their
    // OWN lesson, not a sibling's — mirroring the family-portal student/guardian
    // split (a student shouldn't be able to meddle with a sibling's schedule).
    if (actor.role === 'guardian' || actor.role === 'student') {
      const familyId = await this.resolveFamilyId(orgId, actor.userId);
      const student = await this.db.db.query.students.findFirst({
        where: and(eq(students.id, lesson.studentId), eq(students.organizationId, orgId)),
        columns: { familyId: true, studentUserId: true },
      });
      const ownedByFamily = !!familyId && !!student && student.familyId === familyId;
      const ownedByStudent = actor.role === 'student' ? student?.studentUserId === actor.userId : true;
      if (!ownedByFamily || !ownedByStudent) {
        throw new NotFoundException('Lesson not found');
      }
    }

    // Only a live lesson can be rescheduled. A family that already cancelled a
    // future lesson (cancelled_makeup/cancelled_no_pay, still future-dated) could
    // otherwise file a request against it; a teacher approving it would move a
    // dead-status lesson into a real slot (a no-charge lesson a teacher then
    // teaches). Reject at the door rather than let a junk request through — the
    // decide path and directReschedule enforce the same rule.
    if (!(RESCHEDULABLE_LESSON_STATUSES as readonly string[]).includes(lesson.status)) {
      throw new BadRequestException('That lesson isn’t scheduled, so it can’t be rescheduled. To book a new time, use the booking page.');
    }

    const hoursUntil = (new Date(lesson.startsAt).getTime() - Date.now()) / 3600000;
    if (hoursUntil < 24) throw new BadRequestException('Reschedule requests must be made at least 24 hours before the lesson');

    const tz = await this.getOrgTimezone(this.db.db, orgId);
    const [req] = await this.db.db.insert(rescheduleRequests).values({
      organizationId: orgId,
      lessonId: dto.lessonId,
      requestedBy: actor.userId,
      proposedStartsAt: parseZonedDateTime(dto.proposedStartsAt, tz),
      proposedStartsAt2: dto.proposedStartsAt2 ? parseZonedDateTime(dto.proposedStartsAt2, tz) : undefined,
      proposedStartsAt3: dto.proposedStartsAt3 ? parseZonedDateTime(dto.proposedStartsAt3, tz) : undefined,
      status: 'pending',
    }).returning();
    return req!;
  }

  /** Did this slot clash with an existing lesson? Non-throwing wrapper over checkConflicts. */
  private async hasConflict(
    exec: Executor, orgId: string, startsAt: string, duration: number,
    teacherId?: string, excludeLessonId?: string, studentId?: string,
  ): Promise<boolean> {
    try {
      await this.checkConflicts(exec, orgId, startsAt, duration, teacherId, excludeLessonId, studentId);
      return false;
    } catch {
      return true;
    }
  }

  async getRescheduleRequests(orgId: string, status?: string, actor?: Actor) {
    const rows = await this.db.db.query.rescheduleRequests.findMany({
      where: status
        ? and(eq(rescheduleRequests.organizationId, orgId), eq(rescheduleRequests.status, status as 'pending' | 'approved' | 'denied'))
        : eq(rescheduleRequests.organizationId, orgId),
      with: {
        lesson: {
          with: {
            student: { columns: { id: true, firstName: true, lastName: true } },
            teacher: { columns: { id: true, firstName: true, lastName: true } },
          },
        },
        requestedByUser: { columns: { id: true, email: true } },
      },
      orderBy: (r, { desc }) => [desc(r.createdAt)],
    });

    // Teachers may only see requests against lessons they teach. This list is
    // otherwise studio-wide, so without scoping, opening the page to teachers
    // would show every family's reschedule requests to every teacher.
    let scoped = rows;
    if (actor?.role === 'teacher') {
      const staffId = await this.resolveStaffId(orgId, actor.userId);
      scoped = rows.filter((r) => r.lesson?.teacherId === staffId);
    }

    // Annotate each ranked option so staff can see at a glance which times are
    // free + within the teacher's hours — the basis for slotting students
    // back-to-back instead of chasing one proposed time at a time.
    const tz = await this.getOrgTimezone(this.db.db, orgId);
    return Promise.all(scoped.map(async (r) => {
      const lesson = r.lesson;
      const duration = lesson?.duration ?? 30;
      const teacherId = lesson?.teacherId ?? undefined;
      const ranked = [r.proposedStartsAt, r.proposedStartsAt2, r.proposedStartsAt3].filter(Boolean) as Date[];
      const options = await Promise.all(ranked.map(async (t, i) => {
        const iso = t.toISOString();
        const unavailable = await this.teacherUnavailableReason(this.db.db, orgId, teacherId, iso, duration, tz);
        // Flag the student clash too, so the "ok" badge staff pick from matches
        // what the approval actually enforces — a slot green here but student-busy
        // would otherwise be chosen and then fail on decide.
        const conflict = unavailable ? false : await this.hasConflict(this.db.db, orgId, iso, duration, teacherId, r.lessonId, lesson?.studentId ?? undefined);
        return {
          rank: i + 1,
          startsAt: iso,
          ok: !unavailable && !conflict,
          reason: unavailable ?? (conflict ? 'Clashes with another lesson at that time.' : null),
        };
      }));
      return { ...r, options };
    }));
  }

  async decideRescheduleRequest(orgId: string, id: string, decision: 'approved' | 'denied', decidedBy: string, reason?: string, chosenStartsAt?: string, actor?: Actor) {
    const req = await this.db.db.query.rescheduleRequests.findFirst({
      where: and(eq(rescheduleRequests.id, id), eq(rescheduleRequests.organizationId, orgId)),
      with: { lesson: { columns: { teacherId: true } } },
    });
    if (!req) throw new NotFoundException('Request not found');
    if (req.status !== 'pending') throw new BadRequestException('Request already decided');

    // A teacher may only decide a request against a lesson they teach.
    if (actor?.role === 'teacher') {
      const staffId = await this.resolveStaffId(orgId, actor.userId);
      if (!staffId || req.lesson?.teacherId !== staffId) throw new ForbiddenException('Not your lesson');
    }

    // Resolve which ranked time to approve (defaults to the 1st choice), and
    // validate it BEFORE claiming so a bad pick fails cleanly without leaving the
    // request marked approved but the lesson unmoved.
    let target: string | undefined;
    if (decision === 'approved') {
      const ranked = [req.proposedStartsAt, req.proposedStartsAt2, req.proposedStartsAt3]
        .filter(Boolean).map((d) => (d as Date).toISOString());
      target = chosenStartsAt ? new Date(chosenStartsAt).toISOString() : ranked[0]!;
      if (chosenStartsAt && !ranked.includes(target)) {
        throw new BadRequestException('Chosen time is not one of the requested options');
      }
      const lesson = await this.getLesson(orgId, req.lessonId);
      // Same guard the mutation (directReschedule) enforces, checked BEFORE the
      // claim below. If the lesson was cancelled/completed after the request was
      // raised (e.g. the family cancelled it, or it ran), directReschedule would
      // throw AFTER the request is marked 'approved' — stranding it approved with
      // the lesson unmoved and no way to re-decide (the #190 stuck state). Reject
      // cleanly here so the request stays 'pending'.
      if (!(RESCHEDULABLE_LESSON_STATUSES as readonly string[]).includes(lesson.status)) {
        throw new BadRequestException('That lesson is no longer scheduled, so it can’t be rescheduled.');
      }
      const tz = await this.getOrgTimezone(this.db.db, orgId);
      const unavailable = await this.teacherUnavailableReason(this.db.db, orgId, lesson.teacherId ?? undefined, target, lesson.duration, tz);
      if (unavailable) throw new BadRequestException(unavailable);
      // Include the student in the pre-check, exactly as directReschedule does
      // (checkConflicts at the mutation, below). directReschedule rejects a slot
      // where THIS student is already booked with another teacher; if that check
      // is skipped here, the student clash slips past, the request is claimed as
      // 'approved' (committed just below), and then directReschedule throws —
      // leaving the request permanently 'approved' with the lesson unmoved and no
      // way to re-decide it. Catch it before the claim so the decide fails cleanly.
      if (await this.hasConflict(this.db.db, orgId, target, lesson.duration, lesson.teacherId ?? undefined, req.lessonId, lesson.studentId ?? undefined)) {
        throw new BadRequestException('That time clashes with another lesson.');
      }
    }

    // Guarded claim: only transition if still pending. If a concurrent request
    // already decided it, the WHERE matches zero rows and we stop — so the
    // reschedule below never runs twice.
    const claimed = await this.db.db.update(rescheduleRequests)
      .set({ status: decision, decidedBy, decidedAt: new Date(), reason })
      .where(and(
        eq(rescheduleRequests.id, id),
        eq(rescheduleRequests.organizationId, orgId),
        eq(rescheduleRequests.status, 'pending'),
      ))
      .returning({ id: rescheduleRequests.id });
    if (claimed.length === 0) throw new BadRequestException('Request already decided');

    if (decision === 'approved' && target) {
      await this.directReschedule(orgId, req.lessonId, target);
    }

    return { id, status: decision };
  }

  // ─── Lesson credits ───────────────────────────────────────────────────────
  async getLessonCredits(orgId: string, studentId: string) {
    return this.db.db.query.lessonCredits.findMany({
      where: and(
        eq(lessonCredits.organizationId, orgId),
        eq(lessonCredits.studentId, studentId),
        eq(lessonCredits.status, 'available'),
      ),
      with: { sourceLesson: { columns: { id: true, startsAt: true } } },
      orderBy: (c, { asc }) => [asc(c.createdAt)],
    });
  }

  // ─── Conflict check ────────────────────────────────────────────────────────
  private async checkConflicts(db: Executor, orgId: string, startsAt: string, duration: number, teacherId?: string, excludeLessonId?: string, studentId?: string) {
    const start = new Date(startsAt);
    const end = new Date(start.getTime() + duration * 60000);

    const overlapping = await db.query.lessons.findMany({
      where: and(
        eq(lessons.organizationId, orgId),
        eq(lessons.status, 'scheduled'),
        lte(lessons.startsAt, end),
        // Lower bound only prunes the candidate set; true overlap is decided
        // in-memory below. It MUST reach back at least as far as the longest
        // bookable lesson, or a long lesson that started earlier is dropped from
        // the set and its overlap is missed (double-booking). Lessons can run up
        // to MAX_LESSON_MINUTES (enrollment/staff durations, well past the 240
        // front-desk cap), so look back that far.
        gte(lessons.startsAt, new Date(start.getTime() - SchedulingService.MAX_LESSON_MINUTES * 60000)),
      ),
    });

    // A clash is either resource being double-booked: the same teacher can't
    // teach two lessons at once, and — just as important — a student can't be in
    // two places at once. The student side was previously unchecked, so a child
    // with two teachers (or a staff/portal booking that picked a second teacher)
    // could be booked into overlapping lessons with nothing to stop it. Two
    // instruments back-to-back are fine; only true time overlap counts.
    let teacherClash = false;
    let studentClash = false;
    for (const l of overlapping) {
      if (excludeLessonId && l.id === excludeLessonId) continue;
      const lEnd = new Date(l.startsAt.getTime() + l.duration * 60000);
      if (!(l.startsAt < end && lEnd > start)) continue;
      if (teacherId && l.teacherId === teacherId) teacherClash = true;
      if (studentId && l.studentId === studentId) studentClash = true;
    }

    // Prefer the teacher message when both clash — it's the studio-facing
    // constraint most booking surfaces already surface.
    if (teacherClash) throw new BadRequestException('Teacher already has a lesson at this time');
    if (studentClash) throw new BadRequestException('Student already has a lesson at this time');
  }
}
