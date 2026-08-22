import { Controller, Get, Post, Patch, Body, Param, UseGuards, BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DbService } from '../db/db.service';
import { CreateTermDto } from './dto/create-term.dto';
import { UpdateTermStatusDto } from './dto/update-term-status.dto';
import { UpdateTermExceptionsDto } from './dto/update-term-exceptions.dto';
import { eq, and } from 'drizzle-orm';
import { terms, lessons, lessonRequests, invoiceLineItems } from '@music-life/db';
import type { RequestUser } from '@music-life/types';
import { getOrgTimezone, formatInZone } from '../common/timezone';

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
    if (dto.endsOn <= dto.startsOn) {
      throw new BadRequestException('End date must be after the start date');
    }
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
    @Body() body: UpdateTermStatusDto,
  ) {
    const [updated] = await this.db.db.update(terms)
      .set({ status: body.status, updatedAt: new Date() })
      .where(and(eq(terms.id, id), eq(terms.organizationId, user.orgId)))
      .returning();
    // A term id from another org (or a bogus one) matched nothing, but the
    // org-scoped where clause made that indistinguishable from success — the
    // update silently no-opped and still returned 200 with an empty body,
    // unlike leads.update/organizations.update which both correctly 404.
    if (!updated) throw new NotFoundException('Term not found');
    return updated;
  }

  @Patch(':id/exceptions')
  @Roles('admin')
  async updateExceptions(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: UpdateTermExceptionsDto,
  ) {
    for (const ex of body.exceptionWeeks) {
      if (ex.end < ex.start) {
        throw new BadRequestException('Each exception week must end on or after its start date');
      }
    }
    const [updated] = await this.db.db.update(terms)
      .set({ exceptionWeeks: body.exceptionWeeks, updatedAt: new Date() })
      .where(and(eq(terms.id, id), eq(terms.organizationId, user.orgId)))
      .returning();
    if (!updated) throw new NotFoundException('Term not found');

    // An exception week (half-term, holiday) means the whole studio is closed
    // that week — not just lessons tagged with this term's id (plenty of
    // enrollments carry no termId at all). Setting the exception here must
    // also clear out any lesson that already exists inside it, or "block off
    // this week" would leave real, billable lessons still sitting there.
    // Billed or attended lessons are left alone and reported back so the
    // admin can handle them manually rather than silently losing billing
    // history.
    const removed: { id: string; startsAt: string }[] = [];
    const kept: { id: string; startsAt: string; reason: string }[] = [];
    if (body.exceptionWeeks.length > 0) {
      const tz = await getOrgTimezone(this.db.db, user.orgId);
      const orgLessons = await this.db.db.query.lessons.findMany({
        where: and(eq(lessons.organizationId, user.orgId), eq(lessons.status, 'scheduled')),
        columns: { id: true, startsAt: true },
      });
      for (const l of orgLessons) {
        const dayStr = formatInZone(l.startsAt, tz, { year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-CA');
        const inException = body.exceptionWeeks.some((ex) => dayStr >= ex.start && dayStr <= ex.end);
        if (!inException) continue;
        const billed = await this.db.db.query.invoiceLineItems.findFirst({ where: eq(invoiceLineItems.lessonId, l.id), columns: { id: true } });
        if (billed) { kept.push({ id: l.id, startsAt: l.startsAt.toISOString(), reason: 'billed' }); continue; }
        await this.db.db.transaction(async (tx) => {
          await tx.update(lessonRequests).set({ createdLessonId: null }).where(eq(lessonRequests.createdLessonId, l.id));
          await tx.delete(lessons).where(eq(lessons.id, l.id));
        });
        removed.push({ id: l.id, startsAt: l.startsAt.toISOString() });
      }
    }

    return { ...updated, removedLessons: removed.length, keptBilledLessons: kept.length };
  }
}
