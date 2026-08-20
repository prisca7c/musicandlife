import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { CreatePayrollRunDto } from './dto/create-payroll-run.dto';
import { RequestMyPayrollRunDto } from './dto/request-my-payroll-run.dto';
import { BatchPayrollRunDto } from './dto/batch-payroll-run.dto';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { CreateRateChangeDto } from './dto/create-rate-change.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '@music-life/types';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('staff/payroll')
  @Roles('admin')
  getRuns(@CurrentUser() u: RequestUser, @Query('staffId') staffId?: string) {
    return this.payroll.getPayrollRuns(u.orgId, staffId);
  }

  @Post('staff/payroll')
  @Roles('admin')
  createRun(@CurrentUser() u: RequestUser, @Body() dto: CreatePayrollRunDto) {
    return this.payroll.createPayrollRun(u.orgId, dto);
  }

  @Post('staff/payroll/run-all')
  @Roles('admin')
  runAll(@CurrentUser() u: RequestUser, @Body() dto: BatchPayrollRunDto) {
    return this.payroll.createPayrollRunsForAll(u.orgId, dto.periodStart, dto.periodEnd);
  }

  // A teacher's own pay. Declared before `staff/payroll/:id` so "me" isn't
  // captured as a run id. Teacher-level on purpose: the studio-wide payroll
  // routes above stay manager+, this returns only the caller's own runs.
  @Get('staff/payroll/me')
  @Roles('teacher')
  getMyRuns(@CurrentUser() u: RequestUser) {
    return this.payroll.getMyPayrollRuns(u.orgId, u.userId);
  }

  // A teacher submitting their own hours for review — same "teacher submits,
  // admin approves" shape as expenses/rate-change requests below, just for
  // the payroll run itself. Always for the caller's own staffId.
  @Post('staff/payroll/me')
  @Roles('teacher')
  requestMyRun(@CurrentUser() u: RequestUser, @Body() dto: RequestMyPayrollRunDto) {
    return this.payroll.requestMyPayrollRun(u.orgId, u.userId, dto.periodStart, dto.periodEnd);
  }

  @Get('staff/payroll/:id')
  @Roles('admin')
  getRun(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.payroll.getPayrollRun(u.orgId, id);
  }

  @Post('staff/payroll/:id/approve')
  @Roles('admin')
  approveRun(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.payroll.approvePayrollRun(u.orgId, id, u.userId);
  }

  @Get('expenses')
  @Roles('admin')
  getExpenses(@CurrentUser() u: RequestUser, @Query('staffId') staffId?: string) {
    return this.payroll.getExpenses(u.orgId, staffId);
  }

  @Post('expenses')
  @Roles('teacher')
  createExpense(@CurrentUser() u: RequestUser, @Body() dto: CreateExpenseDto) {
    return this.payroll.createExpense(u.orgId, dto, { role: u.role, userId: u.userId });
  }

  @Post('expenses/:id/approve')
  @Roles('admin')
  approveExpense(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.payroll.approveExpense(u.orgId, id);
  }

  @Get('rate-change-requests')
  @Roles('admin')
  getRateRequests(@CurrentUser() u: RequestUser) {
    return this.payroll.getRateChangeRequests(u.orgId);
  }

  @Post('rate-change-requests')
  @Roles('teacher')
  createRateRequest(@CurrentUser() u: RequestUser, @Body() dto: CreateRateChangeDto) {
    return this.payroll.createRateChangeRequest(u.orgId, dto, { role: u.role, userId: u.userId });
  }

  @Post('rate-change-requests/:id/approve')
  @Roles('admin')
  approveRate(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.payroll.decideRateChange(u.orgId, id, 'approved', u.userId);
  }

  @Post('rate-change-requests/:id/deny')
  @Roles('admin')
  denyRate(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.payroll.decideRateChange(u.orgId, id, 'denied', u.userId);
  }
}
