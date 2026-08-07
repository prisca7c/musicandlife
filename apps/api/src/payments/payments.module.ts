import { Module } from '@nestjs/common';
import { PublicPaymentsController } from './payments.controller';
import { MollieService } from './mollie.service';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [BillingModule],
  controllers: [PublicPaymentsController],
  providers: [MollieService],
  exports: [MollieService],
})
export class PaymentsModule {}
