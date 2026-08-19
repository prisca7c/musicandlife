import { Module } from '@nestjs/common';
import { SchedulingController } from './scheduling.controller';
import { SchedulingService } from './scheduling.service';
import { RecurrenceWorker } from './recurrence.worker';
import { AuthModule } from '../auth/auth.module';
import { AttendanceModule } from '../attendance/attendance.module';

@Module({
  imports: [AuthModule, AttendanceModule],
  controllers: [SchedulingController],
  providers: [SchedulingService, RecurrenceWorker],
  exports: [SchedulingService],
})
export class SchedulingModule {}
