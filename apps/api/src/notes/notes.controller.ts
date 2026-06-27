import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DbService } from '../db/db.service';
import { notes, staffMembers, teacherAssignments, enrollments } from '@music-life/db';
import { eq, and, inArray } from 'drizzle-orm';
import type { RequestUser } from '@music-life/types';

@Controller('notes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotesController {
  constructor(private readonly db: DbService) {}

  private async resolveStaffId(orgId: string, userId: string): Promise<string | null> {
    const staff = await this.db.db.query.staffMembers.findFirst({
      where: and(eq(staffMembers.userId, userId), eq(staffMembers.organizationId, orgId)),
      columns: { id: true },
    });
    return staff?.id ?? null;
  }

  // Union of the explicit teacherAssignments table and enrollments.teacherId — in practice
  // every student-teacher link today comes from an enrollment (see students.service.ts).
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

  @Get()
  @Roles('teacher')
  async findAll(@CurrentUser() user: RequestUser, @Query('studentId') studentId?: string) {
    // Teachers only ever see notes for their own assigned students — never the whole org's.
    if (user.role === 'teacher') {
      const staffId = await this.resolveStaffId(user.orgId, user.userId);
      const assignedIds = staffId ? await this.getAssignedStudentIds(user.orgId, staffId) : [];
      if (studentId && !assignedIds.includes(studentId)) return [];
      if (assignedIds.length === 0) return [];

      return this.db.db.query.notes.findMany({
        where: and(
          eq(notes.organizationId, user.orgId),
          inArray(notes.studentId, studentId ? [studentId] : assignedIds),
        ),
        with: { student: { columns: { id: true, firstName: true, lastName: true } }, author: { columns: { id: true, email: true } } },
        orderBy: (n, { desc }) => [desc(n.createdAt)],
      });
    }

    return this.db.db.query.notes.findMany({
      where: studentId
        ? and(eq(notes.organizationId, user.orgId), eq(notes.studentId, studentId))
        : eq(notes.organizationId, user.orgId),
      with: { student: { columns: { id: true, firstName: true, lastName: true } }, author: { columns: { id: true, email: true } } },
      orderBy: (n, { desc }) => [desc(n.createdAt)],
    });
  }

  @Post()
  @Roles('teacher')
  async create(
    @CurrentUser() user: RequestUser,
    @Body() body: { studentId: string; lessonId?: string; body: string; visibility?: 'internal' | 'family' },
  ) {
    if (user.role === 'teacher') {
      const staffId = await this.resolveStaffId(user.orgId, user.userId);
      const assignedIds = staffId ? await this.getAssignedStudentIds(user.orgId, staffId) : [];
      if (!assignedIds.includes(body.studentId)) throw new ForbiddenException('Not your student');
    }

    const [note] = await this.db.db.insert(notes).values({
      organizationId: user.orgId,
      studentId: body.studentId,
      lessonId: body.lessonId,
      authorId: user.userId,
      body: body.body,
      visibility: body.visibility ?? 'family',
    }).returning();
    return note!;
  }

  @Patch(':id')
  @Roles('teacher')
  async update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: { body?: string; visibility?: 'internal' | 'family' },
  ) {
    if (user.role === 'teacher') {
      const existing = await this.db.db.query.notes.findFirst({
        where: and(eq(notes.id, id), eq(notes.organizationId, user.orgId)),
        columns: { studentId: true },
      });
      const staffId = await this.resolveStaffId(user.orgId, user.userId);
      const assignedIds = staffId ? await this.getAssignedStudentIds(user.orgId, staffId) : [];
      if (!existing || !assignedIds.includes(existing.studentId)) throw new ForbiddenException('Not your student');
    }

    const [updated] = await this.db.db.update(notes)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(notes.id, id), eq(notes.organizationId, user.orgId)))
      .returning();
    return updated!;
  }
}
