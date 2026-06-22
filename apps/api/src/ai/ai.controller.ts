import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '@music-life/types';

@Controller('lessons')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post(':id/recordings')
  @Roles('teacher')
  createRecording(
    @CurrentUser() user: RequestUser,
    @Param('id') lessonId: string,
    @Body() body: { mediaType: 'audio' | 'video'; consent: boolean; mime: string; size: number; originalName?: string },
  ) {
    return this.ai.createRecording(user.orgId, lessonId, user.userId, body);
  }

  @Post(':id/recordings/:rid/summary')
  @Roles('teacher')
  triggerSummary(
    @CurrentUser() user: RequestUser,
    @Param('id') lessonId: string,
    @Param('rid') recordingId: string,
  ) {
    return this.ai.triggerSummary(user.orgId, lessonId, recordingId, user.userId);
  }

  @Get(':id/ai')
  @Roles('teacher')
  getAiData(@CurrentUser() user: RequestUser, @Param('id') lessonId: string) {
    return this.ai.getAiData(user.orgId, lessonId);
  }
}
