import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { SchedulingService } from './scheduling.service';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';
import { CancelLessonDto } from './dto/cancel-lesson.dto';
import { GenerateRecurringDto } from './dto/generate-recurring.dto';
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
    return this.scheduling.getLessons(user.orgId, { weekStart, teacherId, studentId }, { role: user.role, userId: user.userId });
  }

  @Post('lessons')
  @Roles('receptionist')
  createLesson(@CurrentUser() user: RequestUser, @Body() dto: CreateLessonDto) {
    return this.scheduling.createLesson(user.orgId, dto);
  }

  // Materialise an enrollment's weekly schedule into real lessons now, rather than
  // waiting for the daily recurrence worker (so booking a weekly lesson shows up
  // on the calendar immediately).
  @Post('lessons/recurring')
  @Roles('receptionist')
  generateRecurring(@CurrentUser() user: RequestUser, @Body() dto: GenerateRecurringDto) {
    return this.scheduling.materializeEnrollment(user.orgId, dto.enrollmentId, {
      weeks: dto.weeks,
      fromDate: dto.startFrom,
    });
  }

  @Get('lessons/:id')
  @Roles('teacher')
  getLesson(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.scheduling.getLesson(user.orgId, id, { role: user.role, userId: user.userId });
  }

  @Patch('lessons/:id')
  @Roles('receptionist')
  updateLesson(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateLessonDto) {
    return this.scheduling.updateLesson(user.orgId, id, dto);
  }

  @Post('lessons/:id/cancel')
  @Roles('teacher')
  cancelLesson(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: CancelLessonDto) {
    return this.scheduling.cancelLesson(user.orgId, id, dto, user.userId, { role: user.role, userId: user.userId });
  }

  @Post('lessons/:id/reinstate')
  @Roles('teacher')
  reinstateLesson(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.scheduling.reinstateLesson(user.orgId, id, { role: user.role, userId: user.userId });
  }

  @Post('lessons/:id/reschedule')
  @Roles('teacher')
  reschedule(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: { startsAt: string; roomId?: string },
  ) {
    return this.scheduling.directReschedule(user.orgId, id, body.startsAt, body.roomId, { role: user.role, userId: user.userId });
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
    return this.scheduling.decideRescheduleRequest(user.orgId, id, 'approved', user.userId, dto.reason, dto.chosenStartsAt);
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
