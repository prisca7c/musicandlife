import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { PublicInvoiceController } from './public-invoice.controller';
import { BillingService } from './billing.service';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { InvoiceSchedulerWorker } from './invoice-scheduler.worker';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [BillingController, PublicInvoiceController, ReconciliationController],
  providers: [BillingService, ReconciliationService, InvoiceSchedulerWorker],
  exports: [BillingService, ReconciliationService],
})
export class BillingModule {}
