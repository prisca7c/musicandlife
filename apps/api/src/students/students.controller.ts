import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { StudentsService } from './students.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { AttendanceService } from '../attendance/attendance.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { CreateEnrollmentDto } from '../enrollments/dto/create-enrollment.dto';
import { AddStudentCreditsDto } from './dto/add-student-credits.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { parsePage } from '../common/pagination';
import type { RequestUser } from '@music-life/types';

@Controller('students')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudentsController {
  constructor(
    private readonly students: StudentsService,
    private readonly enrollments: EnrollmentsService,
    private readonly attendance: AttendanceService,
  ) {}

  @Get()
  @Roles('teacher')
  findAll(
    @CurrentUser() user: RequestUser,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.students.findAll(user.orgId, user.userId, user.role, {
      search,
      status,
      page: parsePage(limit, offset),
    });
  }

  @Post()
  @Roles('admin')
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateStudentDto) {
    return this.students.create(user.orgId, dto);
  }

  @Get(':id')
  @Roles('teacher')
  findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.students.findOne(user.orgId, id, user.role === 'teacher' ? { userId: user.userId } : undefined);
  }

  @Patch(':id')
  @Roles('admin')
  update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateStudentDto) {
    return this.students.update(user.orgId, id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.students.remove(user.orgId, id);
  }

  @Get(':id/enrollments')
  @Roles('teacher')
  getEnrollments(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.students.getEnrollments(user.orgId, id, user.role === 'teacher' ? { userId: user.userId } : undefined);
  }

  @Post(':id/credits')
  @Roles('admin')
  async addCredits(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: AddStudentCreditsDto) {
    // findOne 404s if the student isn't in this org — addLessonCredits itself
    // trusts whatever studentId it's given, so this is the only thing stopping
    // an admin from crediting a student in another organisation entirely.
    await this.students.findOne(user.orgId, id);
    await this.attendance.addLessonCredits(user.orgId, id, dto.count, dto.type ?? 'prepaid');
    return this.attendance.getLessonCreditBalance(user.orgId, id);
  }

  @Get(':id/credits')
  @Roles('teacher')
  async getCredits(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.students.findOne(user.orgId, id, user.role === 'teacher' ? { userId: user.userId } : undefined);
    return this.attendance.getLessonCreditBalance(user.orgId, id);
  }

  @Post(':id/enrollments')
  @Roles('admin')
  createEnrollment(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreateEnrollmentDto,
  ) {
    return this.enrollments.create(user.orgId, id, dto);
  }
}
