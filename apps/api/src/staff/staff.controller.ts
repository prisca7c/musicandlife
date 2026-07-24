import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, HttpCode } from '@nestjs/common';
import { IsIn, IsString, Matches, IsArray, ArrayNotEmpty, IsDateString, IsOptional, MaxLength } from 'class-validator';

// 24-hour HH:MM. The previous /^\d{2}:\d{2}$/ let through out-of-range values
// like "25:00" or "08:70", which slipped past the service's end>start check and
// poisoned the availability/slot calculations downstream.
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

const WEEKDAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] as const;

class AddAvailabilityDto {
  // Single-day form, kept for the existing caller.
  @IsOptional() @IsIn(WEEKDAYS as unknown as string[])
  weekday?: string;
  // Multi-day form: the same window applied to several days in one submit.
  @IsOptional() @IsArray() @ArrayNotEmpty() @IsIn(WEEKDAYS as unknown as string[], { each: true })
  weekdays?: string[];
  @IsString() @Matches(HH_MM)
  startTime!: string;
  @IsString() @Matches(HH_MM)
  endTime!: string;
}

class AddTimeOffDto {
  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}
import { StaffService } from './staff.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { UpdatePrivilegesDto } from './dto/update-privileges.dto';
import { AssignStudentDto } from './dto/assign-student.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '@music-life/types';

@Controller('staff')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @Roles('manager')
  findAll(@CurrentUser() user: RequestUser) {
    return this.staff.findAll(user.orgId);
  }

  // Active-staff names any teacher may read, to colour and filter the whole-studio
  // calendar. Declared before `:id` so "roster" isn't captured as an id.
  @Get('roster')
  @Roles('teacher')
  roster(@CurrentUser() user: RequestUser) {
    return this.staff.roster(user.orgId);
  }

  @Get('me')
  @Roles('teacher')
  findMe(@CurrentUser() user: RequestUser) {
    return this.staff.findByUserId(user.orgId, user.userId);
  }

  // ─── My own availability (teacher self-service) ──────────────────────────────
  // Declared before the `:id/availability` routes so `me` is not captured by `:id`.
  @Get('me/availability')
  @Roles('teacher')
  getMyAvailability(@CurrentUser() user: RequestUser) {
    return this.staff.getMyAvailability(user.orgId, user.userId);
  }

  // All teachers' windows (manager+) — powers the admin calendar availability overlay.
  @Get('availability/all')
  @Roles('manager')
  getAllAvailability(@CurrentUser() user: RequestUser) {
    return this.staff.getAllAvailability(user.orgId);
  }

  @Post('me/availability')
  @Roles('teacher')
  addMyAvailability(@CurrentUser() user: RequestUser, @Body() dto: AddAvailabilityDto) {
    const days = dto.weekdays ?? (dto.weekday ? [dto.weekday] : []);
    return this.staff.addMyAvailabilityDays(user.orgId, user.userId, days, dto.startTime, dto.endTime);
  }

  @Delete('me/availability/:windowId')
  @Roles('teacher')
  @HttpCode(200)
  removeMyAvailability(@CurrentUser() user: RequestUser, @Param('windowId') windowId: string) {
    return this.staff.removeMyAvailability(user.orgId, user.userId, windowId);
  }

  // ─── My time off (teacher self-service) ─────────────────────────────────────
  // Declared before `:id/...` so `me` is not captured by the id param.
  @Get('me/time-off')
  @Roles('teacher')
  getMyTimeOff(@CurrentUser() user: RequestUser) {
    return this.staff.getMyTimeOff(user.orgId, user.userId);
  }

  @Post('me/time-off')
  @Roles('teacher')
  addMyTimeOff(@CurrentUser() user: RequestUser, @Body() dto: AddTimeOffDto) {
    return this.staff.addMyTimeOff(user.orgId, user.userId, dto.startsAt, dto.endsAt, dto.reason);
  }

  @Delete('me/time-off/:id')
  @Roles('teacher')
  @HttpCode(200)
  removeMyTimeOff(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.staff.removeMyTimeOff(user.orgId, user.userId, id);
  }

  @Post()
  @Roles('manager')
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateStaffDto) {
    return this.staff.create(user.orgId, dto);
  }

  @Get(':id')
  @Roles('manager')
  findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.staff.findOne(user.orgId, id);
  }

  @Patch(':id')
  @Roles('manager')
  update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateStaffDto) {
    return this.staff.update(user.orgId, id, dto);
  }

  @Patch(':id/privileges')
  @Roles('admin')
  updatePrivileges(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdatePrivilegesDto,
  ) {
    return this.staff.updatePrivileges(user.orgId, id, dto.privileges);
  }

  @Post(':id/assignments')
  @Roles('manager')
  assign(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: AssignStudentDto,
  ) {
    return this.staff.assignStudent(user.orgId, id, dto.studentId, dto.role);
  }

  @Delete(':id/assignments/:studentId')
  @Roles('manager')
  removeAssignment(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('studentId') studentId: string,
  ) {
    return this.staff.removeAssignment(user.orgId, id, studentId);
  }

  // ─── Availability ──────────────────────────────────────────────────────────
  @Get(':id/availability')
  @Roles('teacher')
  getAvailability(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.staff.getAvailability(user.orgId, id);
  }

  @Post(':id/availability')
  @Roles('manager')
  addAvailability(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: AddAvailabilityDto,
  ) {
    const days = dto.weekdays ?? (dto.weekday ? [dto.weekday] : []);
    return this.staff.addAvailabilityDays(user.orgId, id, days, dto.startTime, dto.endTime);
  }

  // ─── A teacher's time off (manager view) ───────────────────────────────────
  @Get(':id/time-off')
  @Roles('manager')
  getTimeOff(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.staff.getTimeOff(user.orgId, id);
  }

  @Post(':id/time-off')
  @Roles('manager')
  addTimeOff(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: AddTimeOffDto) {
    return this.staff.addTimeOff(user.orgId, id, dto.startsAt, dto.endsAt, dto.reason);
  }

  @Delete(':id/time-off/:timeOffId')
  @Roles('manager')
  @HttpCode(200)
  removeTimeOff(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('timeOffId') timeOffId: string,
  ) {
    return this.staff.removeTimeOff(user.orgId, id, timeOffId);
  }

  @Delete(':id/availability/:windowId')
  @Roles('manager')
  @HttpCode(200)
  removeAvailability(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('windowId') windowId: string,
  ) {
    return this.staff.removeAvailability(user.orgId, id, windowId);
  }
}
