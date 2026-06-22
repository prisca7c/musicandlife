import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DbService } from '../db/db.service';
import { notes } from '@music-life/db';
import { eq, and } from 'drizzle-orm';
import type { RequestUser } from '@music-life/types';

@Controller('notes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotesController {
  constructor(private readonly db: DbService) {}

  @Get()
  @Roles('teacher')
  findAll(@CurrentUser() user: RequestUser, @Query('studentId') studentId?: string) {
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
    const [updated] = await this.db.db.update(notes)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(notes.id, id), eq(notes.organizationId, user.orgId)))
      .returning();
    return updated!;
  }
}
