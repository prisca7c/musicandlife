import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, NotFoundException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DbService } from '../db/db.service';
import { newsPosts } from '@music-life/db';
import { eq, and } from 'drizzle-orm';
import type { RequestUser } from '@music-life/types';

@Controller('news')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NewsController {
  constructor(private readonly db: DbService) {}

  @Get()
  @Roles('student')
  findAll(@CurrentUser() user: RequestUser) {
    return this.db.db.query.newsPosts.findMany({
      where: eq(newsPosts.organizationId, user.orgId),
      with: { author: { columns: { id: true, email: true } } },
      orderBy: (n, { desc }) => [desc(n.publishedAt)],
    });
  }

  @Post()
  @Roles('admin')
  async create(@CurrentUser() user: RequestUser, @Body() body: { title: string; body: string; publishedAt?: string }) {
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
  async update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() body: { title?: string; body?: string; publishedAt?: string }) {
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
