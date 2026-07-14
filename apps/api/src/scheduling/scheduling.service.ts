import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { eq, and, gte, lte, ne, isNull, sql } from 'drizzle-orm';
import { lessons, rescheduleRequests, lessonCredits, availability, blockedTime, students, staffMembers, rooms, organizations } from '@music-life/db';
import type { Db } from '@music-life/db';
import { DbService } from '../db/db.service';
import type { CreateLessonDto } from './dto/create-lesson.dto';
import type { UpdateLessonDto } from './dto/update-lesson.dto';
import type { CancelLessonDto } from './dto/cancel-lesson.dto';
import type { CreateRescheduleRequestDto } from './dto/reschedule-request.dto';
import type { BaseRole } from '@music-life/types';
import { NotificationsService } from '../notifications/notifications.service';

// Resolves to the caller's own staffId when their role is exactly 'teacher' (so service
// methods can scope/ownership-check); higher roles (receptionist+) act unrestricted.
export interface Actor { role: BaseRole; userId: string }

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
  // both pass the conflict check and then both insert, double-booking a teacher or
  // room. To serialize per-resource we take Postgres transaction-scoped advisory
  // locks keyed on the teacher and room before checking + writing. Locks are
  // acquired in a deterministic (sorted) order so two transactions locking the same
  // pair can never deadlock. This is robust against overlapping (not just identical)
  // slots and needs no schema change / clean data — unlike a unique index.
  private async lockResources(tx: Executor, orgId: string, teacherId?: string | null, roomId?: string | null) {
    const keys: string[] = [];
    if (teacherId) keys.push(`lesson:${orgId}:teacher:${teacherId}`);
    if (roomId) keys.push(`lesson:${orgId}:room:${roomId}`);
    for (const key of keys.sort()) {
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

  // ─── Lessons ──────────────────────────────────────────────────────────────
  async getLessons(orgId: string, params: { weekStart?: string; teacherId?: string; studentId?: string }, actor?: Actor) {
    const base = eq(lessons.organizationId, orgId);
    const rows = await this.db.db.query.lessons.findMany({
      where: params.weekStart
        ? and(base,
            gte(lessons.startsAt, new Date(params.weekStart)),
            lte(lessons.startsAt, new Date(new Date(params.weekStart).getTime() + 7 * 86400 * 1000)))
        : base,
      with: {
        student: { columns: { id: true, firstName: true, lastName: true } },
        teacher: { columns: { id: true, firstName: true, lastName: true } },
        room: { columns: { id: true, name: true } },
        attendance: { columns: { status: true } },
        enrollment: { columns: { instrument: true, lessonType: true, groupName: true } },
      },
      orderBy: (l, { asc }) => [asc(l.startsAt)],
    });

    // Teachers only ever see their own lessons, regardless of the teacherId param —
    // it must not be possible to view another teacher's schedule by passing their id.
    // studentId still narrows further, e.g. "this student's lessons that I teach".
    if (actor?.role === 'teacher') {
      const staffId = await this.resolveStaffId(orgId, actor.userId);
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
        room: true,
        attendance: true,
        enrollment: { columns: { id: true, instrument: true, lessonType: true, groupName: true } },
      },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    if (actor?.role === 'teacher') {
      const staffId = await this.resolveStaffId(orgId, actor.userId);
      if (lesson.teacherId !== staffId) throw new NotFoundException('Lesson not found');
    }
    return lesson;
  }

  async createLesson(orgId: string, dto: CreateLessonDto) {
    return this.db.db.transaction(async (tx) => {
      await this.lockResources(tx, orgId, dto.teacherId, dto.roomId);
      await this.checkConflicts(tx, orgId, dto.startsAt, dto.duration ?? 60, dto.teacherId, dto.roomId);

      const [lesson] = await tx
        .insert(lessons)
        .values({ ...dto, organizationId: orgId, startsAt: new Date(dto.startsAt) })
        .returning();
      return lesson!;
    });
  }

  async updateLesson(orgId: string, id: string, dto: UpdateLessonDto) {
    const existing = await this.getLesson(orgId, id);
    return this.db.db.transaction(async (tx) => {
      if (dto.startsAt || dto.teacherId || dto.roomId) {
        const teacherId = dto.teacherId ?? existing.teacherId ?? undefined;
        const roomId = dto.roomId ?? existing.roomId ?? undefined;
        await this.lockResources(tx, orgId, teacherId, roomId);
        await this.checkConflicts(
          tx,
          orgId,
          dto.startsAt ?? existing.startsAt.toISOString(),
          dto.duration ?? existing.duration,
          teacherId,
          roomId,
          id,
        );
      }
      const [updated] = await tx
        .update(lessons)
        .set({ ...dto, startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined, updatedAt: new Date() })
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

    return { id, status: dto.reason };
  }

  async directReschedule(orgId: string, id: string, newStartsAt: string, newRoomId?: string, actor?: Actor) {
    const lesson = await this.getLesson(orgId, id);
    await this.assertOwnsLesson(orgId, lesson.teacherId, actor);

    return this.db.db.transaction(async (tx) => {
      const teacherId = lesson.teacherId ?? undefined;
      const roomId = newRoomId ?? lesson.roomId ?? undefined;
      await this.lockResources(tx, orgId, teacherId, roomId);
      await this.checkConflicts(tx, orgId, newStartsAt, lesson.duration, teacherId, roomId, id);

      // Reasonable-for-the-teacher check: the new slot must sit inside the
      // teacher's availability windows and not clash with their blocked time.
      const tz = await this.getOrgTimezone(tx, orgId);
      const reason = await this.teacherUnavailableReason(tx, orgId, teacherId, newStartsAt, lesson.duration, tz);
      if (reason) throw new BadRequestException(reason);

      const [updated] = await tx
        .update(lessons)
        .set({ startsAt: new Date(newStartsAt), roomId: newRoomId ?? lesson.roomId, updatedAt: new Date() })
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

  /** Emails the student's family that their lesson time changed. Best-effort. */
  private async notifyRescheduled(orgId: string, lesson: { studentId: string; startsAt: Date }) {
    const student = await this.db.db.query.students.findFirst({
      where: eq(students.id, lesson.studentId),
      columns: { firstName: true },
      with: { family: { columns: { email: true } } },
    });
    const email = student?.family?.email;
    if (!email) return;
    const when = new Date(lesson.startsAt).toLocaleString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    });
    await this.notifications.trigger('lesson.rescheduled', {
      orgId,
      email,
      body: `${student.firstName ?? 'Your child'}'s lesson is now on ${when}.`,
    });
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

  // ─── Reschedule requests ──────────────────────────────────────────────────
  async createRescheduleRequest(orgId: string, dto: CreateRescheduleRequestDto, requestedBy: string) {
    const lesson = await this.getLesson(orgId, dto.lessonId);
    const hoursUntil = (new Date(lesson.startsAt).getTime() - Date.now()) / 3600000;
    if (hoursUntil < 24) throw new BadRequestException('Reschedule requests must be made at least 24 hours before the lesson');

    const [req] = await this.db.db.insert(rescheduleRequests).values({
      organizationId: orgId,
      lessonId: dto.lessonId,
      requestedBy,
      proposedStartsAt: new Date(dto.proposedStartsAt),
      proposedStartsAt2: dto.proposedStartsAt2 ? new Date(dto.proposedStartsAt2) : undefined,
      proposedStartsAt3: dto.proposedStartsAt3 ? new Date(dto.proposedStartsAt3) : undefined,
      proposedRoomId: dto.proposedRoomId,
      status: 'pending',
    }).returning();
    return req!;
  }

  /** Did this slot clash with an existing lesson? Non-throwing wrapper over checkConflicts. */
  private async hasConflict(
    exec: Executor, orgId: string, startsAt: string, duration: number,
    teacherId?: string, roomId?: string, excludeLessonId?: string,
  ): Promise<boolean> {
    try {
      await this.checkConflicts(exec, orgId, startsAt, duration, teacherId, roomId, excludeLessonId);
      return false;
    } catch {
      return true;
    }
  }

  async getRescheduleRequests(orgId: string, status?: string) {
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

    // Annotate each ranked option so staff can see at a glance which times are
    // free + within the teacher's hours — the basis for slotting students
    // back-to-back instead of chasing one proposed time at a time.
    const tz = await this.getOrgTimezone(this.db.db, orgId);
    return Promise.all(rows.map(async (r) => {
      const lesson = r.lesson;
      const duration = lesson?.duration ?? 30;
      const teacherId = lesson?.teacherId ?? undefined;
      const roomId = r.proposedRoomId ?? lesson?.roomId ?? undefined;
      const ranked = [r.proposedStartsAt, r.proposedStartsAt2, r.proposedStartsAt3].filter(Boolean) as Date[];
      const options = await Promise.all(ranked.map(async (t, i) => {
        const iso = t.toISOString();
        const unavailable = await this.teacherUnavailableReason(this.db.db, orgId, teacherId, iso, duration, tz);
        const conflict = unavailable ? false : await this.hasConflict(this.db.db, orgId, iso, duration, teacherId, roomId, r.lessonId);
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

  async decideRescheduleRequest(orgId: string, id: string, decision: 'approved' | 'denied', decidedBy: string, reason?: string, chosenStartsAt?: string) {
    const req = await this.db.db.query.rescheduleRequests.findFirst({
      where: and(eq(rescheduleRequests.id, id), eq(rescheduleRequests.organizationId, orgId)),
    });
    if (!req) throw new NotFoundException('Request not found');
    if (req.status !== 'pending') throw new BadRequestException('Request already decided');

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
      if (await this.hasConflict(this.db.db, orgId, target, lesson.duration, lesson.teacherId ?? undefined, req.proposedRoomId ?? lesson.roomId ?? undefined, req.lessonId)) {
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
      await this.directReschedule(orgId, req.lessonId, target, req.proposedRoomId ?? undefined);
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
  private async checkConflicts(db: Executor, orgId: string, startsAt: string, duration: number, teacherId?: string, roomId?: string, excludeLessonId?: string) {
    const start = new Date(startsAt);
    const end = new Date(start.getTime() + duration * 60000);

    const overlapping = await db.query.lessons.findMany({
      where: and(
        eq(lessons.organizationId, orgId),
        eq(lessons.status, 'scheduled'),
        lte(lessons.startsAt, end),
        gte(lessons.startsAt, new Date(start.getTime() - 180 * 60000)),
      ),
    });

    const conflicts = overlapping.filter(l => {
      if (excludeLessonId && l.id === excludeLessonId) return false;
      const lEnd = new Date(l.startsAt.getTime() + l.duration * 60000);
      const overlaps = l.startsAt < end && lEnd > start;
      if (!overlaps) return false;
      if (teacherId && l.teacherId === teacherId) return true;
      if (roomId && l.roomId === roomId) return true;
      return false;
    });

    if (conflicts.length > 0) {
      const t = conflicts.find(c => c.teacherId === teacherId);
      const r = conflicts.find(c => c.roomId === roomId);
      throw new BadRequestException(
        t ? 'Teacher already has a lesson at this time' : 'Room is already booked at this time'
      );
    }
  }
}
