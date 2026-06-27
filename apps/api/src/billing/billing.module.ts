import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { PublicInvoiceController } from './public-invoice.controller';
import { BillingService } from './billing.service';
import { InvoiceSchedulerWorker } from './invoice-scheduler.worker';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [BillingController, PublicInvoiceController],
  providers: [BillingService, InvoiceSchedulerWorker],
  exports: [BillingService],
})
export class BillingModule {}
