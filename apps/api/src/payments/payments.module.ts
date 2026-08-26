import { Module } from '@nestjs/common';
import { RevolutController } from './revolut.controller';
import { RevolutService } from './revolut.service';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [BillingModule],
  controllers: [RevolutController],
  providers: [RevolutService],
  exports: [RevolutService],
})
export class PaymentsModule {}
