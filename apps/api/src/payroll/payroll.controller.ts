import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { CreatePayrollRunDto } from './dto/create-payroll-run.dto';
import { CreateExpenseDto } from './dto/create-expense.dto';
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
  @Roles('manager')
  getRuns(@CurrentUser() u: RequestUser, @Query('staffId') staffId?: string) {
    return this.payroll.getPayrollRuns(u.orgId, staffId);
  }

  @Post('staff/payroll')
  @Roles('manager')
  createRun(@CurrentUser() u: RequestUser, @Body() dto: CreatePayrollRunDto) {
    return this.payroll.createPayrollRun(u.orgId, dto);
  }

  @Get('staff/payroll/:id')
  @Roles('manager')
  getRun(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.payroll.getPayrollRun(u.orgId, id);
  }

  @Post('staff/payroll/:id/approve')
  @Roles('admin')
  approveRun(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.payroll.approvePayrollRun(u.orgId, id, u.userId);
  }

  @Get('expenses')
  @Roles('manager')
  getExpenses(@CurrentUser() u: RequestUser, @Query('staffId') staffId?: string) {
    return this.payroll.getExpenses(u.orgId, staffId);
  }

  @Post('expenses')
  @Roles('teacher')
  createExpense(@CurrentUser() u: RequestUser, @Body() dto: CreateExpenseDto) {
    return this.payroll.createExpense(u.orgId, dto);
  }

  @Post('expenses/:id/approve')
  @Roles('manager')
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
  createRateRequest(@CurrentUser() u: RequestUser, @Body() body: { staffId: string; requestedRate: number }) {
    return this.payroll.createRateChangeRequest(u.orgId, body.staffId, body.requestedRate);
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
