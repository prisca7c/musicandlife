import { Controller, Get, Header, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CalendarService } from './calendar.service';
import type { RequestUser } from '@music-life/types';

/**
 * The feed itself. Unauthenticated because a calendar app cannot present a
 * bearer token — the unguessable token in the path is the credential, and the
 * response carries nothing but lesson times.
 */
@Controller('public/calendar')
export class PublicCalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get(':token.ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  // A leaked feed URL should never end up in a search index or a shared cache.
  @Header('Cache-Control', 'private, max-age=300')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  async feed(@Param('token') token: string, @Query('student') studentId: string | undefined, @Res() res: Response) {
    const ics = await this.calendar.icsForToken(token, studentId);
    res.send(ics);
  }
}

@Controller('family/calendar')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FamilyCalendarController {
  constructor(private readonly calendar: CalendarService) {}

  // A guardian gets the whole household's feed; a logged-in student gets
  // their own (see CalendarService.familyForUser) — same "student" role
  // floor as the rest of the family portal, not 'guardian', which shut
  // students out of subscribing to their own lesson calendar entirely.
  @Get()
  @Roles('student')
  get(@CurrentUser() user: RequestUser) {
    return this.calendar.getOrCreateFeed(user.userId, user.orgId);
  }

  // Invalidates the previous URL — for when a family thinks the link has spread
  // further than they meant it to.
  @Post('regenerate')
  @Roles('student')
  regenerate(@CurrentUser() user: RequestUser) {
    return this.calendar.regenerate(user.userId, user.orgId);
  }
}
