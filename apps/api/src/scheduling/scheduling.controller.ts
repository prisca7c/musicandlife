import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { SchedulingService } from './scheduling.service';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';
import { CancelLessonDto } from './dto/cancel-lesson.dto';
import { GenerateRecurringDto } from './dto/generate-recurring.dto';
import { CreateRescheduleRequestDto, DecideRescheduleDto } from './dto/reschedule-request.dto';
import { CreateLessonRequestDto, DecideLessonRequestDto, CounterProposeLessonRequestDto } from './dto/lesson-request.dto';
import { RescheduleLessonDto } from './dto/reschedule-lesson.dto';
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
    @Body() body: RescheduleLessonDto,
  ) {
    return this.scheduling.directReschedule(user.orgId, id, body.startsAt, { role: user.role, userId: user.userId });
  }

  // ─── Availability-driven booking ──────────────────────────────────────────
  // Bookable 15-min slots for a teacher on a date (inside their hours, conflict-free).
  @Get('scheduling/available-slots')
  @Roles('teacher')
  availableSlots(
    @CurrentUser() user: RequestUser,
    @Query('teacherId') teacherId: string,
    @Query('date') date: string,
    @Query('duration') duration?: string,
  ) {
    return this.scheduling.getAvailableSlots(user.orgId, teacherId, date, duration ? parseInt(duration, 10) : 60);
  }

  // ─── Lesson requests (front desk proposes ranked times, teacher confirms) ───
  @Post('lesson-requests')
  @Roles('receptionist')
  createLessonRequest(@CurrentUser() user: RequestUser, @Body() dto: CreateLessonRequestDto) {
    return this.scheduling.createLessonRequest(user.orgId, dto, user.userId);
  }

  @Get('lesson-requests')
  @Roles('teacher')
  getLessonRequests(@CurrentUser() user: RequestUser, @Query('status') status?: string) {
    return this.scheduling.getLessonRequests(user.orgId, { role: user.role, userId: user.userId }, status);
  }

  @Post('lesson-requests/:id/confirm')
  @Roles('teacher')
  confirmLessonRequest(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: DecideLessonRequestDto) {
    return this.scheduling.decideLessonRequest(user.orgId, id, 'confirmed', { role: user.role, userId: user.userId }, dto.chosenStartsAt, dto.reason);
  }

  // A teacher who can't make any of the proposed times offers their own instead
  // of the request dying at "Decline".
  @Post('lesson-requests/:id/counter-propose')
  @Roles('teacher')
  counterProposeLessonRequest(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CounterProposeLessonRequestDto,
  ) {
    return this.scheduling.counterProposeLessonRequest(
      user.orgId, id, { role: user.role, userId: user.userId }, dto.times, dto.reason,
    );
  }

  @Post('lesson-requests/:id/decline')
  @Roles('teacher')
  declineLessonRequest(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: DecideLessonRequestDto) {
    return this.scheduling.decideLessonRequest(user.orgId, id, 'declined', { role: user.role, userId: user.userId }, undefined, dto.reason);
  }

  // ─── Reschedule requests ──────────────────────────────────────────────────
  @Post('reschedule-requests')
  @Roles('student')
  createRequest(@CurrentUser() user: RequestUser, @Body() dto: CreateRescheduleRequestDto) {
    return this.scheduling.createRescheduleRequest(user.orgId, dto, { role: user.role, userId: user.userId });
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
