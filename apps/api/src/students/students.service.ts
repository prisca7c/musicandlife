import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, and, ilike, or, inArray } from 'drizzle-orm';
import { students, teacherAssignments, enrollments, families } from '@music-life/db';
import { DbService } from '../db/db.service';
import type { CreateStudentDto } from './dto/create-student.dto';
import type { UpdateStudentDto } from './dto/update-student.dto';
import type { BaseRole } from '@music-life/types';

@Injectable()
export class StudentsService {
  constructor(private readonly db: DbService) {}

  async findAll(orgId: string, userId: string, role: BaseRole, search?: string) {
    // Teachers only see their assigned students
    if (role === 'teacher') {
      const assignments = await this.db.db.query.teacherAssignments.findMany({
        where: and(eq(teacherAssignments.organizationId, orgId)),
        columns: { studentId: true },
      });
      const ids = assignments.map((a) => a.studentId);
      if (ids.length === 0) return [];

      return this.db.db.query.students.findMany({
        where: and(
          eq(students.organizationId, orgId),
          inArray(students.id, ids),
          search
            ? or(
                ilike(students.firstName, `%${search}%`),
                ilike(students.lastName, `%${search}%`),
              )
            : undefined,
        ),
        with: { family: { columns: { id: true, name: true } } },
        orderBy: (s, { asc }) => [asc(s.lastName), asc(s.firstName)],
      });
    }

    return this.db.db.query.students.findMany({
      where: search
        ? and(
            eq(students.organizationId, orgId),
            or(
              ilike(students.firstName, `%${search}%`),
              ilike(students.lastName, `%${search}%`),
            ),
          )
        : eq(students.organizationId, orgId),
      with: { family: { columns: { id: true, name: true } } },
      orderBy: (s, { asc }) => [asc(s.lastName), asc(s.firstName)],
    });
  }

  async findOne(orgId: string, id: string) {
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
    const [updated] = await this.db.db
      .update(students)
      .set({ status: 'withdrawn', updatedAt: new Date() })
      .where(and(eq(students.id, id), eq(students.organizationId, orgId)))
      .returning();
    return updated!;
  }

  async getEnrollments(orgId: string, studentId: string) {
    await this.findOne(orgId, studentId);
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
