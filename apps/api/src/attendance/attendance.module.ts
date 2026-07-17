import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceAutocompleteWorker } from './attendance-autocomplete.worker';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceAutocompleteWorker],
  exports: [AttendanceService],
})
export class AttendanceModule {}
