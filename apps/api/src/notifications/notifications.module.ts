import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { ReminderWorker } from './reminder.worker';
import { AuthModule } from '../auth/auth.module';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, ReminderWorker],
  exports: [NotificationsService],
})
export class NotificationsModule {}
