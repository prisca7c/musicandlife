import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BroadcastService } from './broadcast.service';
import { BroadcastSendDto, BroadcastTestDto } from './dto/broadcast.dto';
import type { RequestUser } from '@music-life/types';

// Composing an email to the whole studio is a management action — receptionists
// and teachers can't reach it (manager = level 70, so admins are included).
@Controller('broadcasts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BroadcastController {
  constructor(private readonly broadcast: BroadcastService) {}

  @Get('audiences')
  @Roles('manager')
  audiences(@CurrentUser() user: RequestUser) {
    return this.broadcast.audienceCounts(user.orgId);
  }

  @Post('test')
  @Roles('manager')
  test(@CurrentUser() user: RequestUser, @Body() dto: BroadcastTestDto) {
    return this.broadcast.sendTest(user.orgId, user.userId, dto.subject, dto.body);
  }

  @Post('send')
  @Roles('manager')
  send(@CurrentUser() user: RequestUser, @Body() dto: BroadcastSendDto) {
    return this.broadcast.send(user.orgId, dto.audience, dto.subject, dto.body);
  }
}
