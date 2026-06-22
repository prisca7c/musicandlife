import { Controller, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '@music-life/types';

@Controller('notification-rules')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Roles('admin')
  getRules(@CurrentUser() user: RequestUser) {
    return this.notifications.getRules(user.orgId);
  }

  @Patch(':id')
  @Roles('admin')
  toggle(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() body: { enabled: boolean }) {
    return this.notifications.toggleRule(user.orgId, id, body.enabled);
  }
}
