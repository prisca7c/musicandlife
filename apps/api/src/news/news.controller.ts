import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, NotFoundException } from '@nestjs/common';
import { CreateNewsDto, UpdateNewsDto } from './dto/news.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DbService } from '../db/db.service';
import { newsPosts } from '@music-life/db';
import { eq, and, lte } from 'drizzle-orm';
import { ROLE_LEVEL, type BaseRole, type RequestUser } from '@music-life/types';

/**
 * A post's `publishedAt` can be set in the future to schedule it (the create/
 * update DTOs accept it, and there's a composite (org, publishedAt) index).
 * Everyone at or above manager manages the news queue and so sees scheduled
 * posts; every other reader (teachers, guardians, students, reception) must only
 * see posts whose publish time has arrived. Returns the cutoff a reader is bound
 * by, or null for management (no bound). Pure, so the gate can be unit-tested.
 */
export function newsPublishedCutoff(role: BaseRole, now: Date): Date | null {
  return ROLE_LEVEL[role] >= ROLE_LEVEL['manager'] ? null : now;
}

@Controller('news')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NewsController {
  constructor(private readonly db: DbService) {}

  @Get()
  @Roles('student')
  findAll(@CurrentUser() user: RequestUser) {
    // Without a publish-time bound a future-dated post is shown to every family
    // the moment it's created — and, ordered by publishedAt desc, pinned to the
    // very top of their feed, defeating the point of scheduling it.
    const cutoff = newsPublishedCutoff(user.role, new Date());
    return this.db.db.query.newsPosts.findMany({
      where: cutoff
        ? and(eq(newsPosts.organizationId, user.orgId), lte(newsPosts.publishedAt, cutoff))
        : eq(newsPosts.organizationId, user.orgId),
      with: { author: { columns: { id: true, email: true } } },
      orderBy: (n, { desc }) => [desc(n.publishedAt)],
    });
  }

  @Post()
  @Roles('admin')
  async create(@CurrentUser() user: RequestUser, @Body() body: CreateNewsDto) {
    const [post] = await this.db.db.insert(newsPosts).values({
      organizationId: user.orgId,
      title: body.title,
      body: body.body,
      authorId: user.userId,
      publishedAt: body.publishedAt ? new Date(body.publishedAt) : undefined,
    }).returning();
    return post!;
  }

  @Patch(':id')
  @Roles('admin')
  async update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() body: UpdateNewsDto) {
    const [updated] = await this.db.db.update(newsPosts)
      .set({ ...body, publishedAt: body.publishedAt ? new Date(body.publishedAt) : undefined })
      .where(and(eq(newsPosts.id, id), eq(newsPosts.organizationId, user.orgId)))
      .returning();
    if (!updated) throw new NotFoundException('News post not found');
    return updated;
  }

  @Delete(':id')
  @Roles('admin')
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const [removed] = await this.db.db.delete(newsPosts)
      .where(and(eq(newsPosts.id, id), eq(newsPosts.organizationId, user.orgId)))
      .returning();
    if (!removed) throw new NotFoundException('News post not found');
    return { id };
  }
}
