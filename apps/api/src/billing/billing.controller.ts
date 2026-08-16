import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { BillingService } from './billing.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { AddLineItemDto } from './dto/add-line-item.dto';
import { PayAtLessonDto } from './dto/pay-at-lesson.dto';
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
  @Roles('admin')
  getInvoices(@CurrentUser() user: RequestUser, @Query('familyId') familyId?: string) {
    return this.billing.getInvoices(user.orgId, familyId);
  }

  @Post('invoices')
  @Roles('admin')
  createInvoice(@CurrentUser() user: RequestUser, @Body() dto: CreateInvoiceDto) {
    return this.billing.createInvoice(user.orgId, dto);
  }

  // Raise one invoice per class (enrolment) for the family, instead of a single
  // combined statement. Returns { invoices: [...] }.
  @Post('invoices/split-by-class')
  @Roles('admin')
  createPerClass(@CurrentUser() user: RequestUser, @Body() dto: CreateInvoiceDto) {
    return this.billing.createInvoicesPerClass(user.orgId, dto);
  }

  @Get('invoices/:id')
  @Roles('admin')
  getInvoice(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.billing.getInvoice(user.orgId, id);
  }

  @Post('invoices/:id/send')
  @Roles('admin')
  sendInvoice(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.billing.sendInvoice(user.orgId, id);
  }

  @Post('invoices/:id/void')
  @Roles('admin')
  voidInvoice(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.billing.voidInvoice(user.orgId, id);
  }

  @Post('invoices/:id/line-items')
  @Roles('admin')
  addLineItem(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: AddLineItemDto,
  ) {
    return this.billing.addLineItem(user.orgId, id, body.description, body.amount, body.lessonId);
  }

  @Patch('invoices/:id/line-items/:lineItemId')
  @Roles('admin')
  updateLineItem(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('lineItemId') lineItemId: string,
    @Body() body: AddLineItemDto,
  ) {
    return this.billing.updateLineItem(user.orgId, id, lineItemId, body.description, body.amount);
  }

  @Delete('invoices/:id/line-items/:lineItemId')
  @Roles('admin')
  removeLineItem(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('lineItemId') lineItemId: string,
  ) {
    return this.billing.removeLineItem(user.orgId, id, lineItemId);
  }

  @Get('families/:id/ledger')
  @Roles('admin')
  getLedger(@CurrentUser() user: RequestUser, @Param('id') id: string, @Query('asOf') asOf?: string) {
    if (asOf) return this.billing.getBalanceAsOf(user.orgId, id, asOf);
    return this.billing.getLedger(user.orgId, id);
  }

  @Post('payments')
  @Roles('admin')
  recordPayment(@CurrentUser() user: RequestUser, @Body() dto: RecordPaymentDto) {
    return this.billing.recordPayment(user.orgId, dto);
  }

  // Record that a family paid for a single lesson on the spot. Produces a paid
  // per-lesson invoice; the payment cancels the lesson's attendance charge.
  @Post('lessons/:id/pay-at-lesson')
  @Roles('admin')
  payAtLesson(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: PayAtLessonDto) {
    return this.billing.payForLesson(user.orgId, id, dto.method);
  }
}
