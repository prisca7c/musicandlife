import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { MessagingService } from './messaging.service';
import { CreateThreadDto } from './dto/create-thread.dto';
import { SendMessageDto } from './dto/send-message.dto';
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

  // Declared before :id so "recipients" isn't captured as a thread id.
  @Get('recipients')
  @Roles('guardian')
  getRecipients(@CurrentUser() user: RequestUser) {
    return this.messaging.getRecipients(user.orgId, user.userId, user.role);
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
    @Body() body: SendMessageDto,
  ) {
    return this.messaging.sendMessage(user.orgId, id, user.userId, body.body);
  }
}
