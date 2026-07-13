import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { MessagingService } from './messaging.service';
import { CreateThreadDto } from './dto/create-thread.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '@music-life/types';

@Controller('threads')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get()
  @Roles('guardian')
  getThreads(@CurrentUser() user: RequestUser) {
    return this.messaging.getThreads(user.orgId, user.userId);
  }

  @Post()
  @Roles('guardian')
  createThread(@CurrentUser() user: RequestUser, @Body() dto: CreateThreadDto) {
    return this.messaging.createThread(user.orgId, user.userId, user.role, dto);
  }

  @Get(':id')
  @Roles('guardian')
  getThread(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.messaging.getThread(user.orgId, id, user.userId);
  }

  @Post(':id/messages')
  @Roles('guardian')
  sendMessage(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: { body: string },
  ) {
    return this.messaging.sendMessage(user.orgId, id, user.userId, body.body);
  }
}
