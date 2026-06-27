import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { RegistrationService } from './registration.service';
import { SubmitRegistrationDto } from './dto/submit-registration.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DbService } from '../db/db.service';
import { ilike, eq } from 'drizzle-orm';
import { families, organizations } from '@music-life/db';
import type { RequestUser } from '@music-life/types';

@Controller()
export class RegistrationController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly db: DbService,
  ) {}

  // Public — no auth
  @Post('public/registrations')
  submit(@Body() dto: SubmitRegistrationDto) {
    return this.registration.submit('music-and-life', dto);
  }

  // Public family search by email — returns minimal info (privacy-safe)
  @Get('public/families/search')
  async searchFamilies(@Query('q') q: string) {
    if (!q || q.length < 3) return [];
    const org = await this.db.db.query.organizations.findFirst({
      where: eq(organizations.slug, 'music-and-life'),
    });
    if (!org) return [];
    const results = await this.db.db.query.families.findMany({
      where: eq(families.organizationId, org.id),
      columns: { id: true, name: true, email: true },
    });
    // Only match by exact email for privacy
    return results
      .filter(f => f.email?.toLowerCase() === q.toLowerCase())
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
    @Body() body: { reason?: string },
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
