import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { eq, and, gte } from 'drizzle-orm';
import { enrollments, students, staffMembers, terms, lessons } from '@music-life/db';
import { DbService } from '../db/db.service';
import type { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import type { UpdateEnrollmentDto } from './dto/update-enrollment.dto';

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
        columns: { id: true },
      });
      if (!teacher) throw new NotFoundException('Teacher not found');
    }
    if (termId) {
      const term = await this.db.db.query.terms.findFirst({
        where: and(eq(terms.id, termId), eq(terms.organizationId, orgId)),
        columns: { id: true },
      });
      if (!term) throw new NotFoundException('Term not found');
    }
  }

  async create(orgId: string, studentId: string, dto: CreateEnrollmentDto) {
    const student = await this.db.db.query.students.findFirst({
      where: and(eq(students.id, studentId), eq(students.organizationId, orgId)),
    });
    if (!student) throw new NotFoundException('Student not found');

    await this.assertTeacherAndTermInOrg(orgId, dto.teacherId, dto.termId);

    // Store the instrument trimmed, and reject a case-/whitespace-variant
    // duplicate of one the student already holds. "Piano" and "piano" (or
    // " piano ") were otherwise persisted as two separate enrolments for the
    // same instrument+teacher+type — which fragments reports and billing and
    // renders as two identical, indistinguishable bookable slots on the family
    // calendar. Match case-insensitively on instrument + teacher + lessonType;
    // a withdrawn enrolment never blocks re-enrolling.
    const instrument = dto.instrument.trim();
    const siblings = await this.db.db.query.enrollments.findMany({
      where: and(eq(enrollments.studentId, studentId), eq(enrollments.organizationId, orgId)),
      columns: { instrument: true, lessonType: true, teacherId: true, status: true },
    });
    const isDuplicate = siblings.some(
      (e) =>
        e.status !== 'withdrawn' &&
        e.lessonType === dto.lessonType &&
        (e.teacherId ?? null) === (dto.teacherId ?? null) &&
        e.instrument.trim().toLowerCase() === instrument.toLowerCase(),
    );
    if (isDuplicate) {
      throw new ConflictException(
        `This student already has a ${dto.lessonType} ${instrument} enrolment${dto.teacherId ? ' with this teacher' : ''}.`,
      );
    }

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
    return enrollment!;
  }

  async update(orgId: string, id: string, dto: UpdateEnrollmentDto) {
    const existing = await this.db.db.query.enrollments.findFirst({
      where: and(eq(enrollments.id, id), eq(enrollments.organizationId, orgId)),
    });
    if (!existing) throw new NotFoundException('Enrollment not found');

    await this.assertTeacherAndTermInOrg(orgId, dto.teacherId, dto.termId);

    // The DTO carries the lesson length as `duration`; the column is
    // `defaultDuration`. create() maps this, but update() spread the DTO raw, so
    // a changed duration was silently dropped. Map it here the same way.
    const { duration, ...rest } = dto;
    const [updated] = await this.db.db
      .update(enrollments)
      .set({
        ...rest,
        ...(duration != null ? { defaultDuration: duration } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(enrollments.id, id), eq(enrollments.organizationId, orgId)))
      .returning();
    return updated!;
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

    const now = new Date();
    const cancelled = await this.db.db
      .update(lessons)
      .set({ status: 'cancelled_no_pay', cancelledAt: now, updatedAt: now })
      .where(and(
        eq(lessons.organizationId, orgId),
        eq(lessons.enrollmentId, id),
        eq(lessons.status, 'scheduled'),
        gte(lessons.startsAt, now),
      ))
      .returning({ id: lessons.id });

    return { stopped: true, cancelledLessons: cancelled.length };
  }
}
