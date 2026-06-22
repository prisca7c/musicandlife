import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, HttpCode } from '@nestjs/common';
import { IsIn, IsString, Matches } from 'class-validator';

class AddAvailabilityDto {
  @IsIn(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])
  weekday!: string;
  @IsString() @Matches(/^\d{2}:\d{2}$/)
  startTime!: string;
  @IsString() @Matches(/^\d{2}:\d{2}$/)
  endTime!: string;
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

  @Get('me')
  @Roles('teacher')
  findMe(@CurrentUser() user: RequestUser) {
    return this.staff.findByUserId(user.orgId, user.userId);
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
    return this.staff.addAvailability(user.orgId, id, dto.weekday, dto.startTime, dto.endTime);
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
