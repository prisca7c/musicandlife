import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { CreateNoteDto, UpdateNoteDto } from './dto/note.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DbService } from '../db/db.service';
import { notes, staffMembers, teacherAssignments, enrollments, students, lessons } from '@music-life/db';
import { eq, and, inArray } from 'drizzle-orm';
import type { RequestUser } from '@music-life/types';

// A media/file attached to a lesson note. `fileId` points at a pre-registered
// row in `files` (uploaded by the teacher via POST /files/sign-upload); the
// family downloads it through a signed URL gated by note ownership.
export interface NoteAttachment { fileId: string; name: string; mime: string; size?: number }

// Keep only well-formed attachment entries so a malformed client body can't
// poison the jsonb column (and later 500 the family portal that reads it).
function cleanAttachments(input: unknown): NoteAttachment[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((a): a is NoteAttachment =>
      !!a && typeof a === 'object'
      && typeof (a as NoteAttachment).fileId === 'string'
      && typeof (a as NoteAttachment).name === 'string'
      && typeof (a as NoteAttachment).mime === 'string')
    .slice(0, 10)
    .map((a) => ({ fileId: a.fileId, name: a.name.slice(0, 255), mime: a.mime.slice(0, 255), size: typeof a.size === 'number' ? a.size : undefined }));
}

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

  /**
   * Attach the author's real name to each note.
   *
   * Notes were rendered from `author.email`, so the studio's record of a pupil
   * said "prisca.meredith.chien" wrote it. These are part of a student's
   * permanent record and get read back months later — a name matters.
   */
  private async withAuthorNames<T extends { authorId: string | null; author?: { id: string; email: string } | null }>(
    orgId: string,
    rows: T[],
  ) {
    const ids = [...new Set(rows.map(r => r.authorId).filter((v): v is string => !!v))];
    const staff = ids.length
      ? await this.db.db.query.staffMembers.findMany({
          where: and(eq(staffMembers.organizationId, orgId), inArray(staffMembers.userId, ids)),
          columns: { userId: true, firstName: true, lastName: true },
        })
      : [];
    const byUser = new Map(staff.filter(s => s.userId).map(s => [s.userId!, `${s.firstName} ${s.lastName}`.trim()]));

    // Matches resolveDisplayName() in auth.service: an account with no staff
    // record (an owner or admin who writes notes) becomes "Prisca", not the raw
    // "prisca.meredith.chien". Same person, same name, everywhere in the app.
    const fromEmail = (email?: string | null) => {
      const prefix = email?.split('@')[0] ?? '';
      const cleaned = prefix.split(/[._-]/)[0] ?? prefix;
      return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : '';
    };

    return rows.map(r => ({
      ...r,
      authorName: (r.authorId && byUser.get(r.authorId)) || fromEmail(r.author?.email) || 'Studio',
    }));
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

      const own = await this.db.db.query.notes.findMany({
        where: and(
          eq(notes.organizationId, user.orgId),
          inArray(notes.studentId, studentId ? [studentId] : assignedIds),
        ),
        with: { student: { columns: { id: true, firstName: true, lastName: true } }, author: { columns: { id: true, email: true } } },
        orderBy: (n, { desc }) => [desc(n.createdAt)],
      });
      return this.withAuthorNames(user.orgId, own);
    }

    const all = await this.db.db.query.notes.findMany({
      where: studentId
        ? and(eq(notes.organizationId, user.orgId), eq(notes.studentId, studentId))
        : eq(notes.organizationId, user.orgId),
      with: { student: { columns: { id: true, firstName: true, lastName: true } }, author: { columns: { id: true, email: true } } },
      orderBy: (n, { desc }) => [desc(n.createdAt)],
    });
    return this.withAuthorNames(user.orgId, all);
  }

  @Post()
  @Roles('teacher')
  async create(
    @CurrentUser() user: RequestUser,
    @Body() body: CreateNoteDto,
  ) {
    if (user.role === 'teacher') {
      const staffId = await this.resolveStaffId(user.orgId, user.userId);
      const assignedIds = staffId ? await this.getAssignedStudentIds(user.orgId, staffId) : [];
      if (!assignedIds.includes(body.studentId)) throw new ForbiddenException('Not your student');
    } else {
      // Manager/admin skip the "your student" check, so the caller-supplied
      // studentId is otherwise unvalidated: a bogus id 500s on the FK violation
      // and a foreign-org id would attach the note to another studio's student.
      const student = await this.db.db.query.students.findFirst({
        where: and(eq(students.id, body.studentId), eq(students.organizationId, user.orgId)),
        columns: { id: true },
      });
      if (!student) throw new ForbiddenException('Not your student');
    }

    // lessonId is a plain uuid column (no DB FK), so a bogus or foreign-org id
    // would be silently stored as a dangling reference — validate it here.
    if (body.lessonId) {
      const lesson = await this.db.db.query.lessons.findFirst({
        where: and(eq(lessons.id, body.lessonId), eq(lessons.organizationId, user.orgId)),
        columns: { id: true },
      });
      if (!lesson) throw new ForbiddenException('Lesson not found');
    }

    const [note] = await this.db.db.insert(notes).values({
      organizationId: user.orgId,
      studentId: body.studentId,
      lessonId: body.lessonId,
      authorId: user.userId,
      body: body.body,
      visibility: body.visibility ?? 'family',
      attachments: cleanAttachments(body.attachments),
    }).returning();
    return note!;
  }

  @Patch(':id')
  @Roles('teacher')
  async update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: UpdateNoteDto,
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

    const { body: text, visibility, attachments } = body;
    const [updated] = await this.db.db.update(notes)
      .set({
        ...(text !== undefined ? { body: text } : {}),
        ...(visibility !== undefined ? { visibility } : {}),
        ...(attachments !== undefined ? { attachments: cleanAttachments(attachments) } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(notes.id, id), eq(notes.organizationId, user.orgId)))
      .returning();
    return updated!;
  }
}
