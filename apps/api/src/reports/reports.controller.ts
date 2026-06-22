import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { staffMembers } from '@music-life/db';
import { ReportsService } from './reports.service';
import { DbService } from '../db/db.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '@music-life/types';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService, private readonly db: DbService) {}

  @Get('dashboard')
  @Roles('teacher')
  async dashboard(@CurrentUser() user: RequestUser) {
    let scopeTeacherId: string | undefined;
    if (user.role === 'teacher') {
      const staff = await this.db.db.query.staffMembers.findFirst({
        where: and(eq(staffMembers.userId, user.userId), eq(staffMembers.organizationId, user.orgId)),
      });
      scopeTeacherId = staff?.id;
    }
    return this.reports.getDashboardKpis(user.orgId, scopeTeacherId);
  }

  @Get('attendance')
  @Roles('manager')
  attendance(
    @CurrentUser() user: RequestUser,
    @Query('from') from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    @Query('to') to = new Date().toISOString().split('T')[0],
  ) {
    return this.reports.getAttendanceReport(user.orgId, from, to);
  }

  @Get('revenue')
  @Roles('manager')
  revenue(
    @CurrentUser() user: RequestUser,
    @Query('from') from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    @Query('to') to = new Date().toISOString().split('T')[0],
  ) {
    return this.reports.getRevenueReport(user.orgId, from, to);
  }

  @Get('enrollments')
  @Roles('manager')
  enrollments(@CurrentUser() user: RequestUser) {
    return this.reports.getEnrollmentReport(user.orgId);
  }

  @Get('student-invoice-pdf')
  @Roles('manager')
  studentInvoicePdf(
    @CurrentUser() user: RequestUser,
    @Query('studentId') studentId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.reports.getStudentInvoicePdfData(user.orgId, studentId, from, to);
  }

  @Get('teacher-payroll-pdf')
  @Roles('manager')
  teacherPayrollPdf(
    @CurrentUser() user: RequestUser,
    @Query('staffId') staffId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.reports.getTeacherPayrollPdfData(user.orgId, staffId, from, to);
  }

  @Get('student-attendance-pdf')
  @Roles('manager')
  studentAttendancePdf(
    @CurrentUser() user: RequestUser,
    @Query('studentId') studentId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.reports.getStudentAttendancePdfData(user.orgId, studentId, from, to);
  }
}
