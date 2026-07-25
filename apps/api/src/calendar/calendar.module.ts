import { Module } from '@nestjs/common';
import { FamilyCalendarController, PublicCalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [PublicCalendarController, FamilyCalendarController],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
