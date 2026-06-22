import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { SchedulingService } from './scheduling.service';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';
import { CancelLessonDto } from './dto/cancel-lesson.dto';
import { CreateRescheduleRequestDto, DecideRescheduleDto } from './dto/reschedule-request.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '@music-life/types';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  // ─── Lessons ──────────────────────────────────────────────────────────────
  @Get('lessons')
  @Roles('teacher')
  getLessons(
    @CurrentUser() user: RequestUser,
    @Query('weekStart') weekStart?: string,
    @Query('teacherId') teacherId?: string,
    @Query('studentId') studentId?: string,
  ) {
    return this.scheduling.getLessons(user.orgId, { weekStart, teacherId, studentId });
  }

  @Post('lessons')
  @Roles('receptionist')
  createLesson(@CurrentUser() user: RequestUser, @Body() dto: CreateLessonDto) {
    return this.scheduling.createLesson(user.orgId, dto);
  }

  @Get('lessons/:id')
  @Roles('teacher')
  getLesson(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.scheduling.getLesson(user.orgId, id);
  }

  @Patch('lessons/:id')
  @Roles('receptionist')
  updateLesson(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateLessonDto) {
    return this.scheduling.updateLesson(user.orgId, id, dto);
  }

  @Post('lessons/:id/cancel')
  @Roles('receptionist')
  cancelLesson(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: CancelLessonDto) {
    return this.scheduling.cancelLesson(user.orgId, id, dto, user.userId);
  }

  @Post('lessons/:id/reschedule')
  @Roles('receptionist')
  reschedule(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: { startsAt: string; roomId?: string },
  ) {
    return this.scheduling.directReschedule(user.orgId, id, body.startsAt, body.roomId);
  }

  // ─── Reschedule requests ──────────────────────────────────────────────────
  @Post('reschedule-requests')
  @Roles('guardian')
  createRequest(@CurrentUser() user: RequestUser, @Body() dto: CreateRescheduleRequestDto) {
    return this.scheduling.createRescheduleRequest(user.orgId, dto, user.userId);
  }

  @Get('reschedule-requests')
  @Roles('receptionist')
  getRequests(@CurrentUser() user: RequestUser, @Query('status') status?: string) {
    return this.scheduling.getRescheduleRequests(user.orgId, status);
  }

  @Post('reschedule-requests/:id/approve')
  @Roles('receptionist')
  approve(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: DecideRescheduleDto) {
    return this.scheduling.decideRescheduleRequest(user.orgId, id, 'approved', user.userId, dto.reason);
  }

  @Post('reschedule-requests/:id/deny')
  @Roles('receptionist')
  deny(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: DecideRescheduleDto) {
    return this.scheduling.decideRescheduleRequest(user.orgId, id, 'denied', user.userId, dto.reason);
  }

  // ─── Lesson credits ───────────────────────────────────────────────────────
  @Get('students/:id/lesson-credits')
  @Roles('teacher')
  getLessonCredits(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.scheduling.getLessonCredits(user.orgId, id);
  }
}
