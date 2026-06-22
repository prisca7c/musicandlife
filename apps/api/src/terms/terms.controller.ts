import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DbService } from '../db/db.service';
import { CreateTermDto } from './dto/create-term.dto';
import { eq, and } from 'drizzle-orm';
import { terms } from '@music-life/db';
import type { RequestUser } from '@music-life/types';

@Controller('terms')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TermsController {
  constructor(private readonly db: DbService) {}

  @Get()
  @Roles('teacher')
  findAll(@CurrentUser() user: RequestUser) {
    return this.db.db.query.terms.findMany({
      where: eq(terms.organizationId, user.orgId),
      orderBy: (t, { desc }) => [desc(t.startsOn)],
    });
  }

  @Post()
  @Roles('admin')
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateTermDto) {
    const [term] = await this.db.db.insert(terms)
      .values({ ...dto, organizationId: user.orgId })
      .returning();
    return term!;
  }

  @Patch(':id/status')
  @Roles('admin')
  async updateStatus(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: { status: 'planned' | 'active' | 'closed' },
  ) {
    const [updated] = await this.db.db.update(terms)
      .set({ status: body.status, updatedAt: new Date() })
      .where(and(eq(terms.id, id), eq(terms.organizationId, user.orgId)))
      .returning();
    return updated!;
  }
}
