import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { eq, and, gte, lte, ne, isNull, inArray, sql } from 'drizzle-orm';
import { lessons, rescheduleRequests, lessonRequests, lessonCredits, availability, blockedTime, students, staffMembers, guardians, organizations, enrollments } from '@music-life/db';
import type { Db } from '@music-life/db';
import { DbService } from '../db/db.service';
import type { CreateLessonDto } from './dto/create-lesson.dto';
import type { UpdateLessonDto } from './dto/update-lesson.dto';
import type { CancelLessonDto } from './dto/cancel-lesson.dto';
import type { CreateRescheduleRequestDto } from './dto/reschedule-request.dto';
import type { CreateLessonRequestDto } from './dto/lesson-request.dto';
import type { BaseRole } from '@music-life/types';
import { NotificationsService } from '../notifications/notifications.service';
import { parseZonedDateTime } from '../common/timezone';

// Resolves to the caller's own staffId when their role is exactly 'teacher' (so service
// methods can scope/ownership-check); higher roles (receptionist+) act unrestricted.
export interface Actor { role: BaseRole; userId: string }

// How many weeks ahead recurring weekly lessons are materialised as real rows.
export const RECURRENCE_WINDOW_WEEKS = 12;

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
  private async lockResources(tx: Executor, orgId: string, teacherId?: string | null) {
    if (!teacherId) return;
    const key = `lesson:${orgId}:teacher:${teacherId}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
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
        enrollment: { columns: { instrument: true, lessonType: true, groupName: true } },
      },
      orderBy: (l, { asc }) => [asc(l.startsAt)],
    });

    if (actor?.role === 'teacher') {
      const staffId = await this.resolveStaffId(orgId, actor.userId);

      // Opt-in whole-studio view (the calendar's "everyone" mode). A teacher may
      // look at the full schedule to see who's teaching when — but a lesson's
      // private notes stay with the teacher who wrote them, so they're stripped
      // from lessons this teacher doesn't teach. The teacherId/studentId filters
      // work the same as for management here. This is read-only: every mutation
      // still goes through assertOwnsLesson, so seeing a lesson never means being
      // able to touch it.
      if (params.scope === 'all') {
        let scoped = rows;
        if (params.teacherId) scoped = scoped.filter(r => r.teacherId === params.teacherId);
        if (params.studentId) scoped = scoped.filter(r => r.studentId === params.studentId);
        return scoped.map(r => (r.teacherId === staffId ? r : { ...r, notes: null }));
      }

      // Default: a teacher sees only their own lessons, regardless of the
      // teacherId param — it must not be possible to view another teacher's
      // schedule by passing their id. studentId still narrows further, e.g.
      // "this student's lessons that I teach". Attendance relies on this scoping.
      let scoped = rows.filter(r => r.teacherId === staffId);
      if (params.studentId) scoped = scoped.filter(r => r.studentId === params.studentId);
      return scoped;
    }

    if (params.teacherId) return rows.filter(r => r.teacherId === params.teacherId);
    if (params.studentId) return rows.filter(r => r.studentId === params.studentId);
    return rows;
  }

  async getLesson(orgId: string, id: string, actor?: Actor) {
    const lesson = await this.db.db.query.lessons.findFirst({
      where: and(eq(lessons.id, id), eq(lessons.organizationId, orgId)),
      with: {
        student: { columns: { id: true, firstName: true, lastName: true } },
        teacher: { columns: { id: true, firstName: true, lastName: true } },
        attendance: true,
        enrollment: { columns: { id: true, instrument: true, lessonType: true, groupName: true } },
      },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    if (actor?.role === 'teacher') {
      const staffId = await this.resolveStaffId(orgId, actor.userId);
      // A teacher can open any lesson's detail from the whole-studio calendar,
      // but another teacher's private notes are withheld. Mutations remain gated
      // by assertOwnsLesson, so read access here grants nothing more.
      if (lesson.teacherId !== staffId) return { ...lesson, notes: null };
    }
    return lesson;
  }

  async createLesson(orgId: string, dto: CreateLessonDto) {
    // A caller-supplied teacherId must belong to this org. Without this, a bad (or
    // foreign-org) id slips past the conflict check and blows up on the row's
    // foreign key — surfacing as a 500 to the family portal. Validate up front so
    // it comes back as a clean 404 and no lesson references another org's teacher.
    if (dto.teacherId) {
      const teacher = await this.db.db.query.staffMembers.findFirst({
        where: and(eq(staffMembers.id, dto.teacherId), eq(staffMembers.organizationId, orgId)),
        columns: { id: true },
      });
      if (!teacher) throw new NotFoundException('Teacher not found');
    }
    return this.db.db.transaction(async (tx) => {
      const tz = await this.getOrgTimezone(tx, orgId);
      // Interpret a naive wall-clock ("...T16:00:00") as the studio's local time.
      const startsAt = parseZonedDateTime(dto.startsAt, tz);
      await this.lockResources(tx, orgId, dto.teacherId);
      await this.checkConflicts(tx, orgId, startsAt.toISOString(), dto.duration ?? 60, dto.teacherId);

      const [lesson] = await tx
        .insert(lessons)
        .values({ ...dto, organizationId: orgId, startsAt })
        .returning();
      return lesson!;
    });
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
    const weeks = Math.min(Math.max(opts?.weeks ?? RECURRENCE_WINDOW_WEEKS, 1), 52);

    const enrollment = await this.db.db.query.enrollments.findFirst({
      where: and(eq(enrollments.id, enrollmentId), eq(enrollments.organizationId, orgId)),
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');

    const rule = enrollment.scheduleRule as { weekday?: string; startTime?: string } | null;
    if (!rule?.weekday || !rule?.startTime) {
      throw new BadRequestException('This enrollment has no weekly schedule (weekday + time) set');
    }

    const tz = await this.getOrgTimezone(this.db.db, orgId);
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

    const existing = await this.db.db.query.lessons.findMany({
      where: and(
        eq(lessons.enrollmentId, enrollment.id),
        gte(lessons.startsAt, from),
        lte(lessons.startsAt, windowEnd),
      ),
      columns: { startsAt: true },
    });
    const existingTimes = new Set(existing.map((l) => l.startsAt.getTime()));

    let created = 0, skippedExisting = 0, skippedConflicts = 0;
    for (const naive of occurrences) {
      const instant = parseZonedDateTime(naive, tz);
      if (existingTimes.has(instant.getTime())) { skippedExisting++; continue; }
      try {
        await this.createLesson(orgId, {
          studentId: enrollment.studentId,
          startsAt: naive,
          duration: enrollment.defaultDuration,
          teacherId: enrollment.teacherId ?? undefined,
          enrollmentId: enrollment.id,
          termId: enrollment.termId ?? undefined,
        });
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
      columns: { id: true, organizationId: true, scheduleRule: true },
    });

    let created = 0, skippedExisting = 0, skippedConflicts = 0;
    for (const e of active) {
      const rule = e.scheduleRule as { weekday?: string; startTime?: string } | null;
      if (!rule?.weekday || !rule?.startTime) continue;
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
        await this.lockResources(tx, orgId, teacherId);
        await this.checkConflicts(
          tx,
          orgId,
          (startsAt ?? existing.startsAt).toISOString(),
          dto.duration ?? existing.duration,
          teacherId,
          id,
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
      await this.lockResources(tx, orgId, teacherId);
      await this.checkConflicts(tx, orgId, lesson.startsAt.toISOString(), lesson.duration, teacherId, id);

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

    return this.db.db.transaction(async (tx) => {
      const teacherId = lesson.teacherId ?? undefined;
      const tz = await this.getOrgTimezone(tx, orgId);
      // Interpret a naive wall-clock as studio-local; a zoned ISO passes through.
      const startsAt = parseZonedDateTime(newStartsAt, tz);
      const startsAtISO = startsAt.toISOString();
      await this.lockResources(tx, orgId, teacherId);
      await this.checkConflicts(tx, orgId, startsAtISO, lesson.duration, teacherId, id);

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
    return { firstName: student?.firstName ?? null, emails };
  }

  /** Emails the student's family (and the student) that their lesson time changed. Best-effort. */
  private async notifyRescheduled(orgId: string, lesson: { studentId: string; startsAt: Date }) {
    const { firstName, emails } = await this.lessonNotifyRecipients(lesson.studentId);
    if (emails.length === 0) return;
    const when = new Date(lesson.startsAt).toLocaleString('en-GB', {
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
    const when = new Date(lesson.startsAt).toLocaleString('en-GB', {
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
    if (!teacherId) return null;
    const start = new Date(startsAtISO);
    const end = new Date(start.getTime() + duration * 60000);

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
              ? inArray(lessonRequests.status, ['pending', 'counter_proposed'])
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
        const conflict = unavailable ? false : await this.hasConflict(this.db.db, orgId, iso, r.duration, r.teacherId);
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
      if (await this.hasConflict(this.db.db, orgId, target, req.duration, req.teacherId)) {
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
    // A counter-proposal is still live — it's awaiting the front desk, not decided.
    if (req.status !== 'pending' && req.status !== 'counter_proposed') {
      throw new BadRequestException('Request already decided');
    }

    // A teacher may only decide their own requests; receptionist+ may decide any.
    if (actor.role === 'teacher') {
      const staffId = await this.resolveStaffId(orgId, actor.userId);
      if (!staffId || req.teacherId !== staffId) throw new ForbiddenException('Not your request');
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
      if (await this.hasConflict(this.db.db, orgId, target, req.duration, req.teacherId)) {
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
    if (actor.role === 'guardian' || actor.role === 'student') {
      const familyId = await this.resolveFamilyId(orgId, actor.userId);
      const student = await this.db.db.query.students.findFirst({
        where: and(eq(students.id, lesson.studentId), eq(students.organizationId, orgId)),
        columns: { familyId: true },
      });
      if (!familyId || !student || student.familyId !== familyId) {
        throw new NotFoundException('Lesson not found');
      }
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
    teacherId?: string, excludeLessonId?: string,
  ): Promise<boolean> {
    try {
      await this.checkConflicts(exec, orgId, startsAt, duration, teacherId, excludeLessonId);
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
        lesson: { with: { student: { columns: { id: true, firstName: true, lastName: true } } } },
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
        const conflict = unavailable ? false : await this.hasConflict(this.db.db, orgId, iso, duration, teacherId, r.lessonId);
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
      const tz = await this.getOrgTimezone(this.db.db, orgId);
      const unavailable = await this.teacherUnavailableReason(this.db.db, orgId, lesson.teacherId ?? undefined, target, lesson.duration, tz);
      if (unavailable) throw new BadRequestException(unavailable);
      if (await this.hasConflict(this.db.db, orgId, target, lesson.duration, lesson.teacherId ?? undefined, req.lessonId)) {
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
  private async checkConflicts(db: Executor, orgId: string, startsAt: string, duration: number, teacherId?: string, excludeLessonId?: string) {
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

    const conflicts = overlapping.filter(l => {
      if (excludeLessonId && l.id === excludeLessonId) return false;
      const lEnd = new Date(l.startsAt.getTime() + l.duration * 60000);
      const overlaps = l.startsAt < end && lEnd > start;
      if (!overlaps) return false;
      if (teacherId && l.teacherId === teacherId) return true;
      return false;
    });

    if (conflicts.length > 0) {
      throw new BadRequestException('Teacher already has a lesson at this time');
    }
  }
}
