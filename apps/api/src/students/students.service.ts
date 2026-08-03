import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, and, ne, gte, ilike, or, inArray, sql, type SQL } from 'drizzle-orm';
import { students, teacherAssignments, enrollments, families, staffMembers, lessons } from '@music-life/db';
import { DbService } from '../db/db.service';
import type { CreateStudentDto } from './dto/create-student.dto';
import type { UpdateStudentDto } from './dto/update-student.dto';
import type { BaseRole } from '@music-life/types';
import type { PageParams, Paginated } from '../common/pagination';

@Injectable()
export class StudentsService {
  constructor(private readonly db: DbService) {}

  private async resolveStaffId(orgId: string, userId: string): Promise<string | null> {
    const staff = await this.db.db.query.staffMembers.findFirst({
      where: and(eq(staffMembers.userId, userId), eq(staffMembers.organizationId, orgId)),
      columns: { id: true },
    });
    return staff?.id ?? null;
  }

  // "Assigned" is the union of the explicit teacherAssignments table (admin-managed,
  // primary/secondary) and enrollments.teacherId — in practice every student-teacher
  // link today comes from an enrollment, since nothing in the app currently writes to
  // teacherAssignments outside the dedicated staff assign/unassign endpoints.
  private async getAssignedStudentIds(orgId: string, staffId: string): Promise<string[]> {
    const [assignments, enrolled] = await Promise.all([
      this.db.db.query.teacherAssignments.findMany({
        where: and(eq(teacherAssignments.organizationId, orgId), eq(teacherAssignments.staffId, staffId)),
        columns: { studentId: true },
      }),
      this.db.db.query.enrollments.findMany({
        where: and(eq(enrollments.organizationId, orgId), eq(enrollments.teacherId, staffId)),
        columns: { studentId: true },
      }),
    ]);
    return [...new Set([...assignments.map((a) => a.studentId), ...enrolled.map((e) => e.studentId)])];
  }

  async findAll(
    orgId: string,
    userId: string,
    role: BaseRole,
    opts: { search?: string; page?: PageParams | null } = {},
  ) {
    const { search, page = null } = opts;
    const searchClause: SQL | undefined = search
      ? or(ilike(students.firstName, `%${search}%`), ilike(students.lastName, `%${search}%`))
      : undefined;

    // Build the WHERE once so the count and the page share identical filtering.
    let whereClause: SQL | undefined;
    if (role === 'teacher') {
      const staffId = await this.resolveStaffId(orgId, userId);
      const ids = staffId ? await this.getAssignedStudentIds(orgId, staffId) : [];
      if (ids.length === 0) {
        return page ? { data: [], total: 0, limit: page.limit, offset: page.offset } : [];
      }
      whereClause = and(eq(students.organizationId, orgId), inArray(students.id, ids), searchClause);
    } else {
      whereClause = and(eq(students.organizationId, orgId), searchClause);
    }

    // Instruments shown in the list come from the student's non-withdrawn
    // enrollments (deduped client-side). `status` lets us drop withdrawn ones.
    const withRelations = {
      family: { columns: { id: true, name: true } },
      enrollments: { columns: { instrument: true, status: true } },
    } as const;

    // Back-compat: no pagination params → return the full array as before.
    if (!page) {
      return this.db.db.query.students.findMany({
        where: whereClause,
        with: withRelations,
        orderBy: (s, { asc }) => [asc(s.lastName), asc(s.firstName)],
      });
    }

    const [rows, countRows] = await Promise.all([
      this.db.db.query.students.findMany({
        where: whereClause,
        with: withRelations,
        orderBy: (s, { asc }) => [asc(s.lastName), asc(s.firstName)],
        limit: page.limit,
        offset: page.offset,
      }),
      this.db.db.select({ c: sql<number>`count(*)::int` }).from(students).where(whereClause),
    ]);
    const result: Paginated<(typeof rows)[number]> = {
      data: rows,
      total: countRows[0]?.c ?? 0,
      limit: page.limit,
      offset: page.offset,
    };
    return result;
  }

  async findOne(orgId: string, id: string, teacherScope?: { userId: string }) {
    const student = await this.db.db.query.students.findFirst({
      where: and(eq(students.id, id), eq(students.organizationId, orgId)),
      with: {
        family: true,
        enrollments: {
          with: { teacher: { columns: { id: true, firstName: true, lastName: true } } },
        },
      },
    });
    if (!student) throw new NotFoundException('Student not found');

    if (teacherScope) {
      const staffId = await this.resolveStaffId(orgId, teacherScope.userId);
      const assignedIds = staffId ? await this.getAssignedStudentIds(orgId, staffId) : [];
      if (!assignedIds.includes(id)) throw new NotFoundException('Student not found');
    }

    return student;
  }

  async create(orgId: string, dto: CreateStudentDto) {
    // Verify family belongs to this org
    const family = await this.db.db.query.families.findFirst({
      where: and(eq(families.id, dto.familyId), eq(families.organizationId, orgId)),
    });
    if (!family) throw new NotFoundException('Family not found');

    const [student] = await this.db.db
      .insert(students)
      .values({ ...dto, organizationId: orgId })
      .returning();
    return student!;
  }

  async update(orgId: string, id: string, dto: UpdateStudentDto) {
    await this.findOne(orgId, id);
    const [updated] = await this.db.db
      .update(students)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(students.id, id), eq(students.organizationId, orgId)))
      .returning();
    return updated!;
  }

  async remove(orgId: string, id: string) {
    await this.findOne(orgId, id);

    // Withdrawing a student must also end their enrolments and clear their diary.
    // Flipping only students.status left every enrolment 'active' with its weekly
    // scheduleRule intact — and the nightly recurrence worker scans on
    // enrolment.status alone (materializeAllRecurring), never the student's — so
    // it kept generating lessons for a child who had left, which autoCompleteOverdue
    // then marked present and CHARGED the family. Already-scheduled future lessons
    // billed the same way. Stop the series and cancel every future scheduled lesson
    // at no charge (mirrors enrollments.stopRecurring). Past/completed lessons are
    // untouched — they happened and are billed as normal. All in one transaction so
    // a withdrawn student can never be left with a live schedule.
    return this.db.db.transaction(async (tx) => {
      const now = new Date();
      const [updated] = await tx
        .update(students)
        .set({ status: 'withdrawn', updatedAt: now })
        .where(and(eq(students.id, id), eq(students.organizationId, orgId)))
        .returning();

      await tx
        .update(enrollments)
        .set({ status: 'withdrawn', scheduleRule: null, updatedAt: now })
        .where(and(
          eq(enrollments.organizationId, orgId),
          eq(enrollments.studentId, id),
          ne(enrollments.status, 'withdrawn'),
        ));

      const cancelled = await tx
        .update(lessons)
        .set({ status: 'cancelled_no_pay', cancelledAt: now, updatedAt: now })
        .where(and(
          eq(lessons.organizationId, orgId),
          eq(lessons.studentId, id),
          eq(lessons.status, 'scheduled'),
          gte(lessons.startsAt, now),
        ))
        .returning({ id: lessons.id });

      return { ...updated!, cancelledLessons: cancelled.length };
    });
  }

  async getEnrollments(orgId: string, studentId: string, teacherScope?: { userId: string }) {
    await this.findOne(orgId, studentId, teacherScope);
    return this.db.db.query.enrollments.findMany({
      where: and(
        eq(enrollments.studentId, studentId),
        eq(enrollments.organizationId, orgId),
      ),
      with: {
        teacher: { columns: { id: true, firstName: true, lastName: true } },
        term: { columns: { id: true, name: true, status: true } },
      },
    });
  }
}
