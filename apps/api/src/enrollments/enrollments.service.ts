import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { eq, and, gte } from 'drizzle-orm';
import { enrollments, students, staffMembers, terms, lessons, lessonCredits } from '@music-life/db';
import { DbService } from '../db/db.service';
import type { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import type { UpdateEnrollmentDto } from './dto/update-enrollment.dto';
import type { Actor } from '../scheduling/scheduling.service';

@Injectable()
export class EnrollmentsService {
  constructor(private readonly db: DbService) {}

  // Both create and update accept caller-supplied teacher/term FK ids. Without an
  // org-scoped existence check a bogus id 500s on the FK violation, and a valid id
  // from another studio would be silently persisted as a cross-org reference.
  private async assertTeacherAndTermInOrg(orgId: string, teacherId?: string | null, termId?: string | null) {
    if (teacherId) {
      const teacher = await this.db.db.query.staffMembers.findFirst({
        where: and(eq(staffMembers.id, teacherId), eq(staffMembers.organizationId, orgId)),
        columns: { id: true, status: true },
      });
      if (!teacher) throw new NotFoundException('Teacher not found');
      // Booking (#193), direct recurring materialization, and recurrence
      // generation (#172) all already refuse an inactive teacher; enrollment
      // create/update was the one write path still missing the check — a
      // receptionist could point a brand-new (or re-pointed) enrolment at a
      // deactivated teacher, who'd then start accumulating a real, billable
      // series invisible to the "active staff" payroll batch.
      if (teacher.status !== 'active') {
        throw new BadRequestException('This teacher is not active. Choose an active teacher, or reactivate them first.');
      }
    }
    if (termId) {
      const term = await this.db.db.query.terms.findFirst({
        where: and(eq(terms.id, termId), eq(terms.organizationId, orgId)),
        columns: { id: true },
      });
      if (!term) throw new NotFoundException('Term not found');
    }
  }

  // Reject a case-/whitespace-variant duplicate of an enrolment the student
  // already holds. "Piano" and "piano" (or " piano ") were otherwise persisted
  // as two separate enrolments for the same instrument+teacher+type — which
  // fragments reports and billing and renders as two identical, indistinguishable
  // bookable slots on the family calendar. Match case-insensitively on trimmed
  // instrument + teacher + lessonType. A withdrawn enrolment never blocks (so
  // re-enrolling is fine), and excludeId skips the row being updated in-place.
  private async assertNoDuplicateEnrollment(
    orgId: string,
    studentId: string,
    effective: { instrument: string; lessonType: 'private' | 'group'; teacherId: string | null },
    excludeId?: string,
  ) {
    const instrument = effective.instrument.trim();
    const siblings = await this.db.db.query.enrollments.findMany({
      where: and(eq(enrollments.studentId, studentId), eq(enrollments.organizationId, orgId)),
      columns: { id: true, instrument: true, lessonType: true, teacherId: true, status: true },
    });
    const isDuplicate = siblings.some(
      (e) =>
        (excludeId === undefined || e.id !== excludeId) &&
        e.status !== 'withdrawn' &&
        e.lessonType === effective.lessonType &&
        (e.teacherId ?? null) === effective.teacherId &&
        e.instrument.trim().toLowerCase() === instrument.toLowerCase(),
    );
    if (isDuplicate) {
      throw new ConflictException(
        `This student already has a ${effective.lessonType} ${instrument} enrolment${effective.teacherId ? ' with this teacher' : ''}.`,
      );
    }
  }

  async findOne(orgId: string, id: string) {
    const enrollment = await this.db.db.query.enrollments.findFirst({
      where: and(eq(enrollments.id, id), eq(enrollments.organizationId, orgId)),
      with: { teacher: { columns: { id: true, firstName: true, lastName: true } } },
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    return enrollment;
  }

  async create(orgId: string, studentId: string, dto: CreateEnrollmentDto) {
    const student = await this.db.db.query.students.findFirst({
      where: and(eq(students.id, studentId), eq(students.organizationId, orgId)),
    });
    if (!student) throw new NotFoundException('Student not found');

    await this.assertTeacherAndTermInOrg(orgId, dto.teacherId, dto.termId);

    // Store the instrument trimmed and reject a variant-duplicate.
    const instrument = dto.instrument.trim();
    await this.assertNoDuplicateEnrollment(orgId, studentId, {
      instrument,
      lessonType: dto.lessonType,
      teacherId: dto.teacherId ?? null,
    });

    const { duration, ...rest } = dto;
    const [enrollment] = await this.db.db
      .insert(enrollments)
      .values({
        ...rest,
        instrument,
        ...(duration != null ? { defaultDuration: duration } : {}),
        studentId,
        organizationId: orgId,
      })
      .returning();

    // A withdrawn student's records are correctly readable and re-enrollable
    // (the sibling comment above says so — re-enrolling is fine), but nothing
    // brought students.status back in step: the new enrolment went live and
    // billable while the student stayed flagged 'withdrawn' — invisible in
    // "active students" filters and the status-breakdown report even though
    // they now have a real, active enrolment. Mirrors #171 in reverse: that
    // fix cascades a student withdrawal DOWN to enrolments; this cascades a
    // fresh enrolment back UP to the student when it undoes a prior withdrawal.
    const effectiveStatus = dto.status ?? 'active';
    if (student.status === 'withdrawn' && effectiveStatus !== 'withdrawn') {
      await this.db.db.update(students)
        .set({ status: effectiveStatus, updatedAt: new Date() })
        .where(eq(students.id, studentId));
    }

    return enrollment!;
  }

  async update(orgId: string, id: string, dto: UpdateEnrollmentDto, actor?: Actor) {
    const existing = await this.db.db.query.enrollments.findFirst({
      where: and(eq(enrollments.id, id), eq(enrollments.organizationId, orgId)),
    });
    if (!existing) throw new NotFoundException('Enrollment not found');

    // A teacher may reach this route only to set their OWN enrolment's weekly
    // schedule (the calendar's "Add lesson" → Repeat weekly, self-booking) —
    // not to touch rate, instrument, status, or another teacher's enrolment.
    // Everything else here stays admin-only.
    if (actor?.role === 'teacher') {
      const staffId = await this.db.db.query.staffMembers.findFirst({
        where: eq(staffMembers.userId, actor.userId), columns: { id: true },
      });
      if (!staffId || existing.teacherId !== staffId.id) {
        throw new ForbiddenException('You can only manage your own enrolments.');
      }
      const allowedKeys = new Set(['scheduleRule']);
      const attempted = Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== undefined);
      if (attempted.some((k) => !allowedKeys.has(k))) {
        throw new ForbiddenException('You can only change the weekly schedule for your own enrolment.');
      }
    }

    await this.assertTeacherAndTermInOrg(orgId, dto.teacherId, dto.termId);

    // Renaming an instrument (or switching teacher/lessonType) can collide with
    // a sibling enrolment just as create can. Compute the post-update effective
    // values — each field falls back to the existing row when the DTO omits it —
    // and reject a variant-duplicate, unless the result is itself withdrawn (a
    // withdrawn enrolment can't own a bookable slot, so it can't collide).
    const instrument = dto.instrument !== undefined ? dto.instrument.trim() : existing.instrument;
    const effectiveStatus = dto.status ?? existing.status;
    // Withdrawing an enrolment ends its series, exactly like stopRecurring — but
    // this generic update only flipped the status, leaving the recurrence rule
    // and every already-generated future lesson on the books. The worker keys on
    // status='active' so it stops making NEW lessons, but the materialised future
    // ones sat 'scheduled' on the teacher's diary and the family portal (and were
    // one attendance-mark away from being charged). Staff had to remember to also
    // hit "Stop weekly". A withdraw now clears the rule and cancels future lessons
    // itself. Same class as the student-withdraw fix: to end a series, tear down
    // the enrolment's recurrence, not just its status.
    const isWithdrawing = effectiveStatus === 'withdrawn' && existing.status !== 'withdrawn';
    if (effectiveStatus !== 'withdrawn') {
      await this.assertNoDuplicateEnrollment(
        orgId,
        existing.studentId,
        {
          instrument,
          lessonType: dto.lessonType ?? existing.lessonType,
          teacherId: dto.teacherId !== undefined ? (dto.teacherId ?? null) : (existing.teacherId ?? null),
        },
        id,
      );
    }

    // The DTO carries the lesson length as `duration`; the column is
    // `defaultDuration`. create() maps this, but update() spread the DTO raw, so
    // a changed duration was silently dropped. Map it here the same way. Persist
    // the instrument trimmed too, matching create().
    const { duration, ...rest } = dto;
    const [updated] = await this.db.db
      .update(enrollments)
      .set({
        ...rest,
        ...(dto.instrument !== undefined ? { instrument } : {}),
        ...(duration != null ? { defaultDuration: duration } : {}),
        // On withdraw, clear the recurrence rule too (wins over any scheduleRule
        // the DTO carried) so a later re-activation can't silently resume a stale
        // series.
        ...(isWithdrawing ? { scheduleRule: null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(enrollments.id, id), eq(enrollments.organizationId, orgId)))
      .returning();

    // Clear the diary of lessons that will never happen now the enrolment has ended.
    if (isWithdrawing) await this.cancelFutureLessons(orgId, id);

    // A trial student graduates to 'active' on their own once every one of
    // their (non-withdrawn) enrolments has been switched to active — staff
    // otherwise had to remember a separate step to flip students.status after
    // approving the last trial enrolment, and a student sitting on "trial"
    // with fully active enrolments doesn't show up in the Active list. Only
    // fires on the transition INTO active, and only for a student currently
    // on trial — an already-active or paused/waiting student's status isn't
    // ours to reinterpret here.
    if (effectiveStatus === 'active' && existing.status !== 'active') {
      const student = await this.db.db.query.students.findFirst({
        where: and(eq(students.id, existing.studentId), eq(students.organizationId, orgId)),
        columns: { id: true, status: true },
      });
      if (student?.status === 'trial') {
        const siblings = await this.db.db.query.enrollments.findMany({
          where: eq(enrollments.studentId, existing.studentId),
          columns: { status: true },
        });
        const live = siblings.filter(e => e.status !== 'withdrawn');
        if (live.length > 0 && live.every(e => e.status === 'active')) {
          await this.db.db.update(students)
            .set({ status: 'active', updatedAt: new Date() })
            .where(eq(students.id, existing.studentId));
        }
      }
    }

    return updated!;
  }

  // Cancel every already-generated FUTURE scheduled lesson for an enrollment at
  // no charge. Past/completed lessons are untouched. Shared by stopRecurring and
  // by a withdraw (both end the series, so both must clear the diary of lessons
  // that will never happen). Returns how many were cancelled.
  private async cancelFutureLessons(orgId: string, enrollmentId: string, now = new Date()) {
    const cancelled = await this.db.db
      .update(lessons)
      .set({ status: 'cancelled_no_pay', cancelledAt: now, updatedAt: now })
      .where(and(
        eq(lessons.organizationId, orgId),
        eq(lessons.enrollmentId, enrollmentId),
        eq(lessons.status, 'scheduled'),
        gte(lessons.startsAt, now),
      ))
      .returning({ id: lessons.id });
    return cancelled.length;
  }

  // Stop an ongoing weekly series: clear the recurrence rule (so the worker stops
  // generating new lessons) and cancel any already-generated future lessons for
  // this enrollment at no charge. Past/completed lessons are untouched.
  async stopRecurring(orgId: string, id: string) {
    const existing = await this.db.db.query.enrollments.findFirst({
      where: and(eq(enrollments.id, id), eq(enrollments.organizationId, orgId)),
    });
    if (!existing) throw new NotFoundException('Enrollment not found');

    await this.db.db
      .update(enrollments)
      .set({ scheduleRule: null, updatedAt: new Date() })
      .where(and(eq(enrollments.id, id), eq(enrollments.organizationId, orgId)));

    const cancelledLessons = await this.cancelFutureLessons(orgId, id);
    return { stopped: true, cancelledLessons };
  }

  // A genuine hard delete, distinct from withdraw: withdraw is the right tool
  // for an enrolment that ran for real (it keeps the record + lesson history
  // for the audit trail), but an enrolment created by pure mistake — wrong
  // student, duplicate click, never actually happened — has no history worth
  // keeping and clutters the list forever since withdrawn rows stay visible.
  // Only blocked by real, irreversible history: any lesson (past or future) or
  // an already-USED credit tied to this enrolment. An unspent lesson request
  // that never became a lesson isn't history (the eventual lesson, if any,
  // is what the lessons check catches). An AVAILABLE (unused) credit isn't
  // history either — it's banked money the student/family hasn't spent yet,
  // sometimes just a legacy-import artifact sitting on a placeholder
  // enrolment — so it's kept, reassigned to no particular enrolment (the
  // pool is scoped by student, and pickCreditForEnrollment already falls
  // back to an enrolment-less credit), rather than silently destroyed along
  // with the mistaken enrolment record.
  async remove(orgId: string, id: string) {
    const existing = await this.db.db.query.enrollments.findFirst({
      where: and(eq(enrollments.id, id), eq(enrollments.organizationId, orgId)),
    });
    if (!existing) throw new NotFoundException('Enrollment not found');

    const [anyLesson] = await this.db.db.query.lessons.findMany({
      where: eq(lessons.enrollmentId, id), columns: { id: true }, limit: 1,
    });
    const [anyUsedCredit] = await this.db.db.query.lessonCredits.findMany({
      where: and(eq(lessonCredits.enrollmentId, id), eq(lessonCredits.status, 'used')),
      columns: { id: true }, limit: 1,
    });
    if (anyLesson || anyUsedCredit) {
      throw new ConflictException(
        'This enrolment has lesson history and can’t be deleted — withdraw it instead to end it while keeping the record.',
      );
    }

    await this.db.db.transaction(async (tx) => {
      await tx.update(lessonCredits)
        .set({ enrollmentId: null })
        .where(and(eq(lessonCredits.enrollmentId, id), eq(lessonCredits.status, 'available')));
      await tx.delete(enrollments).where(and(eq(enrollments.id, id), eq(enrollments.organizationId, orgId)));
    });
    return { deleted: true };
  }
}
