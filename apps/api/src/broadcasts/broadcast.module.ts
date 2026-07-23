import { Module } from '@nestjs/common';
import { BroadcastController } from './broadcast.controller';
import { BroadcastService } from './broadcast.service';
import { AuthModule } from '../auth/auth.module';

// EmailPort is provided globally by EmailModule; NotificationsService's TEMPLATES
// are imported statically, so no module import is needed for them.
@Module({
  imports: [AuthModule],
  controllers: [BroadcastController],
  providers: [BroadcastService],
})
export class BroadcastModule {}
