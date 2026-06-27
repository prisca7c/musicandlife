import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { StudentsService } from './students.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { CreateEnrollmentDto } from '../enrollments/dto/create-enrollment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '@music-life/types';

@Controller('students')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudentsController {
  constructor(
    private readonly students: StudentsService,
    private readonly enrollments: EnrollmentsService,
  ) {}

  @Get()
  @Roles('teacher')
  findAll(@CurrentUser() user: RequestUser, @Query('search') search?: string) {
    return this.students.findAll(user.orgId, user.userId, user.role, search);
  }

  @Post()
  @Roles('receptionist')
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateStudentDto) {
    return this.students.create(user.orgId, dto);
  }

  @Get(':id')
  @Roles('teacher')
  findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.students.findOne(user.orgId, id, user.role === 'teacher' ? { userId: user.userId } : undefined);
  }

  @Patch(':id')
  @Roles('receptionist')
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

  @Post(':id/enrollments')
  @Roles('receptionist')
  createEnrollment(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreateEnrollmentDto,
  ) {
    return this.enrollments.create(user.orgId, id, dto);
  }
}
