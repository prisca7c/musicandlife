import { Controller, Get, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { IsString } from 'class-validator';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '@music-life/types';

class UpsertEmailTemplateDto {
  @IsString() subject!: string;
  @IsString() html!: string;
}

@Controller('email-templates')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmailTemplatesController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Roles('admin')
  list(@CurrentUser() user: RequestUser) {
    return this.notifications.getEmailTemplates(user.orgId);
  }

  @Put(':templateId')
  @Roles('admin')
  upsert(@CurrentUser() user: RequestUser, @Param('templateId') templateId: string, @Body() dto: UpsertEmailTemplateDto) {
    return this.notifications.upsertEmailTemplate(user.orgId, templateId, dto.subject, dto.html);
  }

  @Delete(':templateId')
  @Roles('admin')
  revert(@CurrentUser() user: RequestUser, @Param('templateId') templateId: string) {
    return this.notifications.revertEmailTemplate(user.orgId, templateId);
  }
}
