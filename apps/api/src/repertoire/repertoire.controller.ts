import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import { repertoirePieces, staffMembers, teacherAssignments, enrollments, students } from '@music-life/db';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DbService } from '../db/db.service';
import { CreatePieceDto, UpdatePieceDto } from './dto/repertoire.dto';
import type { RequestUser } from '@music-life/types';

/**
 * What each student is working on.
 *
 * The `repertoire_pieces` table has existed since the schema was written, but
 * there was no module behind it — the Content page told staff to "create
 * assignments via the API directly" and quoted two endpoints that did not
 * exist. This is that module.
 *
 * Scoping mirrors lesson notes exactly: a teacher only ever sees and edits
 * pieces for students they actually teach (assignment ∪ enrollment).
 */
@Controller('repertoire')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RepertoireController {
  constructor(private readonly db: DbService) {}

  private async resolveStaffId(orgId: string, userId: string): Promise<string | null> {
    const staff = await this.db.db.query.staffMembers.findFirst({
      where: and(eq(staffMembers.userId, userId), eq(staffMembers.organizationId, orgId)),
      columns: { id: true },
    });
    return staff?.id ?? null;
  }

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
    return [...new Set([...assignments.map(a => a.studentId), ...enrolled.map(e => e.studentId)])];
  }

  // The students the caller may touch. Returns null for management (no limit).
  private async visibleStudentIds(user: RequestUser): Promise<string[] | null> {
    if (user.role !== 'teacher') return null;
    const staffId = await this.resolveStaffId(user.orgId, user.userId);
    return staffId ? this.getAssignedStudentIds(user.orgId, staffId) : [];
  }

  @Get()
  @Roles('teacher')
  async findAll(@CurrentUser() user: RequestUser, @Query('studentId') studentId?: string) {
    const allowed = await this.visibleStudentIds(user);
    if (allowed !== null) {
      if (studentId && !allowed.includes(studentId)) return [];
      if (allowed.length === 0) return [];
    }

    const scope = studentId
      ? [eq(repertoirePieces.studentId, studentId)]
      : allowed !== null
        ? [inArray(repertoirePieces.studentId, allowed)]
        : [];

    return this.db.db.query.repertoirePieces.findMany({
      where: and(eq(repertoirePieces.organizationId, user.orgId), ...scope),
      with: {
        student: { columns: { id: true, firstName: true, lastName: true } },
        teacher: { columns: { id: true, firstName: true, lastName: true } },
      },
      // Active work first, finished pieces last — the list is a working tool,
      // not an archive, and a long "completed" tail buried what's current.
      orderBy: (p, { asc, desc }) => [asc(p.status), desc(p.updatedAt)],
    });
  }

  private async assertCanTouchStudent(user: RequestUser, studentId: string) {
    const student = await this.db.db.query.students.findFirst({
      where: and(eq(students.id, studentId), eq(students.organizationId, user.orgId)),
      columns: { id: true },
    });
    if (!student) throw new NotFoundException('Student not found');

    const allowed = await this.visibleStudentIds(user);
    if (allowed !== null && !allowed.includes(studentId)) {
      throw new ForbiddenException('Not your student');
    }
  }

  @Post()
  @Roles('teacher')
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreatePieceDto) {
    await this.assertCanTouchStudent(user, dto.studentId);

    // Attribute the piece to the teacher who set it. Staff without a staff
    // record (an owner or admin) simply leave it unattributed rather than
    // borrowing someone else's id.
    const teacherId = await this.resolveStaffId(user.orgId, user.userId);

    const [piece] = await this.db.db.insert(repertoirePieces).values({
      organizationId: user.orgId,
      studentId: dto.studentId,
      teacherId: teacherId ?? undefined,
      title: dto.title,
      composer: dto.composer ?? null,
      instrument: dto.instrument ?? null,
      status: dto.status ?? 'learning',
      notes: dto.notes ?? null,
    }).returning();
    return piece!;
  }

  private async loadOwn(user: RequestUser, id: string) {
    const piece = await this.db.db.query.repertoirePieces.findFirst({
      where: and(eq(repertoirePieces.id, id), eq(repertoirePieces.organizationId, user.orgId)),
    });
    if (!piece) throw new NotFoundException('Piece not found');
    await this.assertCanTouchStudent(user, piece.studentId);
    return piece;
  }

  @Patch(':id')
  @Roles('teacher')
  async update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdatePieceDto) {
    await this.loadOwn(user, id);
    const [updated] = await this.db.db.update(repertoirePieces)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(repertoirePieces.id, id), eq(repertoirePieces.organizationId, user.orgId)))
      .returning();
    return updated!;
  }

  @Delete(':id')
  @Roles('teacher')
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.loadOwn(user, id);
    await this.db.db.delete(repertoirePieces)
      .where(and(eq(repertoirePieces.id, id), eq(repertoirePieces.organizationId, user.orgId)));
    return { id };
  }
}
