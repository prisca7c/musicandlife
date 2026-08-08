import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { MyNotificationsController } from './my-notifications.controller';
import { EmailTemplatesController } from './email-templates.controller';
import { NotificationsService } from './notifications.service';
import { ReminderWorker } from './reminder.worker';
import { AuthModule } from '../auth/auth.module';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController, MyNotificationsController, EmailTemplatesController],
  providers: [NotificationsService, ReminderWorker],
  exports: [NotificationsService],
})
export class NotificationsModule {}
