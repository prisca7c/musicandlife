import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BroadcastService } from './broadcast.service';
import { BroadcastPreviewDto, BroadcastSendDto, BroadcastTestDto } from './dto/broadcast.dto';
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

  // The subgroup options offered on the compose screen (instruments actually
  // taught, named group classes, teachers with students).
  @Get('segments')
  @Roles('manager')
  segments(@CurrentUser() user: RequestUser) {
    return this.broadcast.segments(user.orgId);
  }

  // Headcount for the current selection, so nothing is ever sent blind.
  @Post('preview')
  @Roles('manager')
  preview(@CurrentUser() user: RequestUser, @Body() dto: BroadcastPreviewDto) {
    return this.broadcast.preview(user.orgId, dto.audience, dto.filter);
  }

  // Every other bulk/sensitive action in this codebase (auth, payments,
  // registration) has its own @Throttle; this one relied on the global
  // 120/min default, which is effectively no limit at all for a full-audience
  // email blast — a compromised or scripted manager session could fire up to
  // 120 broadcasts a minute. Real usage is at most a handful a day.
  @Post('send')
  @Roles('manager')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  send(@CurrentUser() user: RequestUser, @Body() dto: BroadcastSendDto) {
    return this.broadcast.send(user.orgId, dto.audience, dto.subject, dto.body, dto.filter);
  }
}
