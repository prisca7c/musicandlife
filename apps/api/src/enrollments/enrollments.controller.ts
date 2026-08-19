import { Controller, Get, Patch, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { EnrollmentsService } from './enrollments.service';
import { UpdateEnrollmentDto } from './dto/update-enrollment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '@music-life/types';

@Controller('enrollments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  // Self-fetching editor support (EditEnrollmentModal) — admin-only, matching
  // every other write on this resource.
  @Get(':id')
  @Roles('admin')
  findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.enrollments.findOne(user.orgId, id);
  }

  // Teacher-or-above: a teacher may only set the weekly scheduleRule on their
  // OWN enrolment (the calendar's "Add lesson" → Repeat weekly, self-booking)
  // — every other field, and every other teacher's enrolments, stay admin-only.
  @Patch(':id')
  @Roles('teacher')
  update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateEnrollmentDto) {
    return this.enrollments.update(user.orgId, id, dto, { role: user.role, userId: user.userId });
  }

  // Stop an ongoing weekly series (clear the rule + cancel future lessons).
  @Post(':id/stop-recurring')
  @Roles('admin')
  stopRecurring(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.enrollments.stopRecurring(user.orgId, id);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.enrollments.remove(user.orgId, id);
  }
}
