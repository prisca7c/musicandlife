import { Module } from '@nestjs/common';
import { FamilyPortalController } from './family-portal.controller';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { BillingModule } from '../billing/billing.module';
import { SchedulingModule } from '../scheduling/scheduling.module';

@Module({
  imports: [AuthModule, EmailModule, AttendanceModule, BillingModule, SchedulingModule],
  controllers: [FamilyPortalController],
})
export class FamilyPortalModule {}
