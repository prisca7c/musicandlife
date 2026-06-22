import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '@music-life/types';

@Controller('organizations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get('me')
  @Roles('teacher')
  getMe(@CurrentUser() user: RequestUser) {
    return this.orgs.findById(user.orgId);
  }

  @Patch('me')
  @Roles('admin')
  updateMe(@CurrentUser() user: RequestUser, @Body() body: { name?: string; settings?: Record<string, unknown> }) {
    return this.orgs.update(user.orgId, body);
  }
}
