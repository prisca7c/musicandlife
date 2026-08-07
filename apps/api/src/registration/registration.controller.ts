import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RegistrationService } from './registration.service';
import { SubmitRegistrationDto } from './dto/submit-registration.dto';
import { DenyRegistrationDto } from './dto/deny-registration.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DbService } from '../db/db.service';
import { and, eq, sql } from 'drizzle-orm';
import { families, organizations } from '@music-life/db';
import type { RequestUser } from '@music-life/types';

@Controller()
export class RegistrationController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly db: DbService,
  ) {}

  // Public — no auth. Each submit emails BOTH the admin and the caller-supplied
  // contactEmail, so without its own limit the endpoint is a limited open relay:
  // an attacker could email-bomb an arbitrary address (or flood the admin inbox)
  // off the studio's sending reputation, up to the 120/min global default. A
  // human fills this form once; 5/min per IP leaves ample room for a retry or a
  // shared connection while removing the abuse headroom. Mirrors auth's public
  // POSTs, which are all individually throttled.
  @Post('public/registrations')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  submit(@Body() dto: SubmitRegistrationDto) {
    return this.registration.submit('music-and-life', dto);
  }

  // Public family search by email — returns minimal info (privacy-safe). Exact
  // match only, but unauthenticated: without a tighter limit it is an
  // email-existence + family-name oracle testable at the 120/min global default.
  // A sibling confirming their family looks up once; 10/min per IP is plenty.
  @Get('public/families/search')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async searchFamilies(@Query('q') q: string) {
    if (!q || q.length < 3) return [];
    const org = await this.db.db.query.organizations.findFirst({
      where: eq(organizations.slug, 'music-and-life'),
    });
    if (!org) return [];
    // Match the exact email in the DB (case-insensitive) rather than loading the
    // whole families table into memory on every unauthenticated call. Still exact-
    // only — this endpoint lets a sibling confirm an existing family to join, so it
    // never does prefix/partial matching.
    const results = await this.db.db.query.families.findMany({
      where: and(
        eq(families.organizationId, org.id),
        sql`lower(${families.email}) = ${q.toLowerCase()}`,
      ),
      columns: { name: true, email: true },
      limit: 1,
    });
    return results
      .filter(f => f.email)
      .map(f => ({ email: f.email!, name: f.name }));
  }

  // Admin
  @Get('registrations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('receptionist')
  list(@CurrentUser() user: RequestUser, @Query('status') status?: string) {
    return this.registration.list(user.orgId, status);
  }

  @Post('registrations/:id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('receptionist')
  approve(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.registration.approve(user.orgId, id, user.userId);
  }

  @Post('registrations/:id/deny')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('receptionist')
  deny(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: DenyRegistrationDto,
  ) {
    return this.registration.deny(user.orgId, id, user.userId, body.reason);
  }

  // CSV student import
  @Post('registrations/import/preview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  previewImport(@Body() body: { csv: string }) {
    return this.registration.previewImport(body.csv);
  }

  @Post('registrations/import/commit')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  commitImport(@CurrentUser() user: RequestUser, @Body() body: { rows: Record<string, string>[] }) {
    return this.registration.commitImport(user.orgId, body.rows);
  }
}
