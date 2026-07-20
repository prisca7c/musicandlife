import { Controller, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '@music-life/types';

// Untyped inline bodies bypass the global ValidationPipe, so a non-boolean
// `enabled` used to reach the boolean column unchecked. Type it.
class ToggleRuleDto {
  @IsBoolean() enabled!: boolean;
}

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
  toggle(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() body: ToggleRuleDto) {
    return this.notifications.toggleRule(user.orgId, id, body.enabled);
  }
}
