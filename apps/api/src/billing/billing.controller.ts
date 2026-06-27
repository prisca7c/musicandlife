import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { BillingService } from './billing.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '@music-life/types';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('invoices')
  @Roles('receptionist')
  getInvoices(@CurrentUser() user: RequestUser, @Query('familyId') familyId?: string) {
    return this.billing.getInvoices(user.orgId, familyId);
  }

  @Post('invoices')
  @Roles('receptionist')
  createInvoice(@CurrentUser() user: RequestUser, @Body() dto: CreateInvoiceDto) {
    return this.billing.createInvoice(user.orgId, dto);
  }

  @Get('invoices/:id')
  @Roles('receptionist')
  getInvoice(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.billing.getInvoice(user.orgId, id);
  }

  @Post('invoices/:id/send')
  @Roles('receptionist')
  sendInvoice(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.billing.sendInvoice(user.orgId, id);
  }

  @Post('invoices/:id/void')
  @Roles('admin')
  voidInvoice(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.billing.voidInvoice(user.orgId, id);
  }

  @Post('invoices/:id/line-items')
  @Roles('receptionist')
  addLineItem(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: { description: string; amount: number; lessonId?: string },
  ) {
    return this.billing.addLineItem(user.orgId, id, body.description, body.amount, body.lessonId);
  }

  @Get('families/:id/ledger')
  @Roles('receptionist')
  getLedger(@CurrentUser() user: RequestUser, @Param('id') id: string, @Query('asOf') asOf?: string) {
    if (asOf) return this.billing.getBalanceAsOf(user.orgId, id, asOf);
    return this.billing.getLedger(user.orgId, id);
  }

  @Post('payments')
  @Roles('receptionist')
  recordPayment(@CurrentUser() user: RequestUser, @Body() dto: RecordPaymentDto) {
    return this.billing.recordPayment(user.orgId, dto);
  }
}
