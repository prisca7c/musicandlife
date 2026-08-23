import { Controller, Get, Patch, Body, Param, UseGuards, BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DbService } from '../db/db.service';
import { UpdateTermStatusDto } from './dto/update-term-status.dto';
import { UpdateTermExceptionsDto } from './dto/update-term-exceptions.dto';
import { UpdateTermDatesDto } from './dto/update-term-dates.dto';
import { eq, and } from 'drizzle-orm';
import { terms } from '@music-life/db';
import type { RequestUser } from '@music-life/types';

// The studio always runs the same three named terms, year after year — an
// admin only ever needs to move a term's dates and half-term week forward to
// the next school year, never create or delete a term. These are the three
// canonical slots findAll() auto-seeds so they're always present.
const SEASON_NAMES = ['Autumn Term', 'Spring Term', 'Summer Term'] as const;

// Rough placeholder dates for a freshly-seeded term, based on a typical UK
// academic year — purely a starting point; the admin overwrites these via
// the dates editor immediately.
function defaultSeasonDates(name: (typeof SEASON_NAMES)[number], now: Date): { startsOn: string; endsOn: string } {
  // The academic year that "now" falls in starts in September — Jan-Aug counts
  // as the back half of the year that began the previous September.
  const academicYearStart = now.getMonth() >= 8 /* Sep = 8 */ ? now.getFullYear() : now.getFullYear() - 1;
  const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m, day)).toISOString().slice(0, 10);
  switch (name) {
    case 'Autumn Term':
      return { startsOn: d(academicYearStart, 8, 1), endsOn: d(academicYearStart, 11, 19) };
    case 'Spring Term':
      return { startsOn: d(academicYearStart + 1, 0, 6), endsOn: d(academicYearStart + 1, 2, 27) };
    case 'Summer Term':
      return { startsOn: d(academicYearStart + 1, 3, 14), endsOn: d(academicYearStart + 1, 6, 18) };
  }
}

@Controller('terms')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TermsController {
  constructor(private readonly db: DbService) {}

  @Get()
  @Roles('teacher')
  async findAll(@CurrentUser() user: RequestUser) {
    const existing = await this.db.db.query.terms.findMany({
      where: eq(terms.organizationId, user.orgId),
    });

    let changed = false;
    for (const name of SEASON_NAMES) {
      if (existing.some((t) => t.name === name)) continue;

      // An org migrating onto the fixed three-slot model may already have a
      // real term whose name just isn't the exact canonical string yet (e.g.
      // "Autumn Term 2026", set up before this existed) — adopt the first one
      // that looks like this season by renaming it in place, so its id (and
      // every enrollment/lesson/invoice already pointing at it) stays intact.
      // Only insert a fresh placeholder when nothing matches at all.
      const seasonWord = name.split(' ')[0]!.toLowerCase();
      const candidate = existing.find((t) =>
        t.name.toLowerCase().startsWith(seasonWord) && !SEASON_NAMES.includes(t.name as never));
      if (candidate) {
        await this.db.db.update(terms)
          .set({ name, updatedAt: new Date() })
          .where(eq(terms.id, candidate.id));
      } else {
        await this.db.db.insert(terms).values({
          organizationId: user.orgId,
          name,
          ...defaultSeasonDates(name, new Date()),
          status: 'planned' as const,
        }).onConflictDoNothing();
      }
      changed = true;
    }

    if (!changed) return existing.sort((a, b) => a.startsOn.localeCompare(b.startsOn));
    const fresh = await this.db.db.query.terms.findMany({
      where: eq(terms.organizationId, user.orgId),
    });
    return fresh.sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  }

  @Patch(':id/dates')
  @Roles('admin')
  async updateDates(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: UpdateTermDatesDto,
  ) {
    if (body.endsOn <= body.startsOn) {
      throw new BadRequestException('End date must be after the start date');
    }
    // weekCount is cosmetic (display only — nothing schedules off it), so it's
    // kept in step with the real span automatically instead of asking the
    // admin to also update a separate lesson count every time the dates move.
    const weeks = Math.max(1, Math.round(
      (new Date(`${body.endsOn}T00:00:00Z`).getTime() - new Date(`${body.startsOn}T00:00:00Z`).getTime()) / (7 * 86400000),
    ));
    const [updated] = await this.db.db.update(terms)
      .set({ startsOn: body.startsOn, endsOn: body.endsOn, weekCount: weeks, updatedAt: new Date() })
      .where(and(eq(terms.id, id), eq(terms.organizationId, user.orgId)))
      .returning();
    if (!updated) throw new NotFoundException('Term not found');
    return updated;
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

    // An exception week (half-term, holiday) is a visual "closed" warning on
    // the calendar only — students and teachers sometimes arrange makeup
    // lessons during a break week, so booking stays allowed and existing
    // lessons in the range are left untouched.
    return updated;
  }
}
