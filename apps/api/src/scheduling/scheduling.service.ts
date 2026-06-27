import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { eq, and, gte, lte, ne, isNull } from 'drizzle-orm';
import { lessons, rescheduleRequests, lessonCredits, availability, blockedTime, students, staffMembers, rooms } from '@music-life/db';
import { DbService } from '../db/db.service';
import type { CreateLessonDto } from './dto/create-lesson.dto';
import type { UpdateLessonDto } from './dto/update-lesson.dto';
import type { CancelLessonDto } from './dto/cancel-lesson.dto';
import type { CreateRescheduleRequestDto } from './dto/reschedule-request.dto';
import type { BaseRole } from '@music-life/types';

// Resolves to the caller's own staffId when their role is exactly 'teacher' (so service
// methods can scope/ownership-check); higher roles (receptionist+) act unrestricted.
export interface Actor { role: BaseRole; userId: string }

@Injectable()
export class SchedulingService {
  constructor(private readonly db: DbService) {}

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
    await this.checkConflicts(orgId, dto.startsAt, dto.duration ?? 60, dto.teacherId, dto.roomId);

    const [lesson] = await this.db.db
      .insert(lessons)
      .values({ ...dto, organizationId: orgId, startsAt: new Date(dto.startsAt) })
      .returning();
    return lesson!;
  }

  async updateLesson(orgId: string, id: string, dto: UpdateLessonDto) {
    const existing = await this.getLesson(orgId, id);
    if (dto.startsAt || dto.teacherId || dto.roomId) {
      await this.checkConflicts(
        orgId,
        dto.startsAt ?? existing.startsAt.toISOString(),
        dto.duration ?? existing.duration,
        dto.teacherId ?? existing.teacherId ?? undefined,
        dto.roomId ?? existing.roomId ?? undefined,
        id,
      );
    }
    const [updated] = await this.db.db
      .update(lessons)
      .set({ ...dto, startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined, updatedAt: new Date() })
      .where(and(eq(lessons.id, id), eq(lessons.organizationId, orgId)))
      .returning();
    return updated!;
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
    await this.checkConflicts(orgId, newStartsAt, lesson.duration, lesson.teacherId ?? undefined, newRoomId ?? lesson.roomId ?? undefined, id);

    const [updated] = await this.db.db
      .update(lessons)
      .set({ startsAt: new Date(newStartsAt), roomId: newRoomId ?? lesson.roomId, updatedAt: new Date() })
      .where(eq(lessons.id, id))
      .returning();
    return updated!;
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
      proposedRoomId: dto.proposedRoomId,
      status: 'pending',
    }).returning();
    return req!;
  }

  async getRescheduleRequests(orgId: string, status?: string) {
    return this.db.db.query.rescheduleRequests.findMany({
      where: status
        ? and(eq(rescheduleRequests.organizationId, orgId), eq(rescheduleRequests.status, status as 'pending' | 'approved' | 'denied'))
        : eq(rescheduleRequests.organizationId, orgId),
      with: {
        lesson: { with: { student: { columns: { id: true, firstName: true, lastName: true } } } },
        requestedByUser: { columns: { id: true, email: true } },
      },
      orderBy: (r, { desc }) => [desc(r.createdAt)],
    });
  }

  async decideRescheduleRequest(orgId: string, id: string, decision: 'approved' | 'denied', decidedBy: string, reason?: string) {
    const req = await this.db.db.query.rescheduleRequests.findFirst({
      where: and(eq(rescheduleRequests.id, id), eq(rescheduleRequests.organizationId, orgId)),
    });
    if (!req) throw new NotFoundException('Request not found');
    if (req.status !== 'pending') throw new BadRequestException('Request already decided');

    await this.db.db.update(rescheduleRequests)
      .set({ status: decision, decidedBy, decidedAt: new Date(), reason })
      .where(eq(rescheduleRequests.id, id));

    if (decision === 'approved') {
      await this.directReschedule(orgId, req.lessonId, req.proposedStartsAt.toISOString(), req.proposedRoomId ?? undefined);
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
  private async checkConflicts(orgId: string, startsAt: string, duration: number, teacherId?: string, roomId?: string, excludeLessonId?: string) {
    const start = new Date(startsAt);
    const end = new Date(start.getTime() + duration * 60000);

    const overlapping = await this.db.db.query.lessons.findMany({
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
