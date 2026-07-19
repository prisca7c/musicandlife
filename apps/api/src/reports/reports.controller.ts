import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { staffMembers } from '@music-life/db';
import { ReportsService } from './reports.service';
import { DbService } from '../db/db.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { toCsv } from '../common/csv';
import { ParseIsoDatePipe } from '../common/parse-iso-date.pipe';
import type { RequestUser } from '@music-life/types';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService, private readonly db: DbService) {}

  private sendCsv(res: Response, filename: string, rows: Record<string, unknown>[]) {
    res.header('Content-Type', 'text/csv');
    res.header('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return toCsv(rows);
  }

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
  async attendance(
    @CurrentUser() user: RequestUser,
    @Query('from', ParseIsoDatePipe) from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    @Query('to', ParseIsoDatePipe) to = new Date().toISOString().split('T')[0],
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const data = await this.reports.getAttendanceReport(user.orgId, from, to);
    if (format === 'csv') return this.sendCsv(res!, 'attendance', data.byStatus);
    return data;
  }

  @Get('revenue')
  @Roles('manager')
  async revenue(
    @CurrentUser() user: RequestUser,
    @Query('from', ParseIsoDatePipe) from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    @Query('to', ParseIsoDatePipe) to = new Date().toISOString().split('T')[0],
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const data = await this.reports.getRevenueReport(user.orgId, from, to);
    if (format === 'csv') return this.sendCsv(res!, 'revenue', data.byType);
    return data;
  }

  @Get('enrollments')
  @Roles('manager')
  async enrollments(
    @CurrentUser() user: RequestUser,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const data = await this.reports.getEnrollmentReport(user.orgId);
    if (format === 'csv') return this.sendCsv(res!, 'enrollments', data.byInstrument);
    return data;
  }

  @Get('retention')
  @Roles('manager')
  async retention(
    @CurrentUser() user: RequestUser,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const data = await this.reports.getRetentionReport(user.orgId);
    if (format === 'csv') return this.sendCsv(res!, 'retention', data.byMonth);
    return data;
  }

  @Get('student-invoice-pdf')
  @Roles('manager')
  studentInvoicePdf(
    @CurrentUser() user: RequestUser,
    @Query('studentId') studentId: string,
    @Query('from', ParseIsoDatePipe) from: string,
    @Query('to', ParseIsoDatePipe) to: string,
  ) {
    return this.reports.getStudentInvoicePdfData(user.orgId, studentId, from, to);
  }

  @Get('teacher-payroll-pdf')
  @Roles('manager')
  teacherPayrollPdf(
    @CurrentUser() user: RequestUser,
    @Query('staffId') staffId: string,
    @Query('from', ParseIsoDatePipe) from: string,
    @Query('to', ParseIsoDatePipe) to: string,
  ) {
    return this.reports.getTeacherPayrollPdfData(user.orgId, staffId, from, to);
  }

  @Get('student-attendance-pdf')
  @Roles('manager')
  studentAttendancePdf(
    @CurrentUser() user: RequestUser,
    @Query('studentId') studentId: string,
    @Query('from', ParseIsoDatePipe) from: string,
    @Query('to', ParseIsoDatePipe) to: string,
  ) {
    return this.reports.getStudentAttendancePdfData(user.orgId, studentId, from, to);
  }
}
