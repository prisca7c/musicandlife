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

  // 'student' is the correct floor, not 'guardian' — ROLE_LEVEL puts student (10)
  // below guardian (20), so @Roles('guardian') silently 403'd a student's own
  // JWT on every route here even though the service layer (teacherFamilyUserIds,
  // NON_STAFF_ROLES, participant checks) already treats guardian/student
  // identically and a teacher can add a student as a thread participant. Matches
  // the floor used throughout family-portal.controller.ts.
  @Get()
  @Roles('student')
  getThreads(@CurrentUser() user: RequestUser) {
    return this.messaging.getThreads(user.orgId, user.userId);
  }

  @Post()
  @Roles('student')
  createThread(@CurrentUser() user: RequestUser, @Body() dto: CreateThreadDto) {
    return this.messaging.createThread(user.orgId, user.userId, user.role, dto);
  }

  // Declared before :id so "recipients" isn't captured as a thread id.
  @Get('recipients')
  @Roles('student')
  getRecipients(@CurrentUser() user: RequestUser) {
    return this.messaging.getRecipients(user.orgId, user.userId, user.role);
  }

  // Reviewing other people's conversations is an admin power, not a
  // management-wide one — deliberately above manager/reception.
  @Get('oversight')
  @Roles('admin')
  getOversightThreads(@CurrentUser() user: RequestUser) {
    return this.messaging.getOversightThreads(user.orgId, user.userId);
  }

  @Get('oversight/:id')
  @Roles('admin')
  getOversightThread(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.messaging.getOversightThread(user.orgId, id);
  }

  @Get('unread-count')
  @Roles('student')
  getUnreadCount(@CurrentUser() user: RequestUser) {
    return this.messaging.getUnreadCount(user.orgId, user.userId);
  }

  @Get(':id')
  @Roles('student')
  getThread(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.messaging.getThread(user.orgId, id, user.userId);
  }

  @Post(':id/messages')
  @Roles('student')
  sendMessage(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: SendMessageDto,
  ) {
    return this.messaging.sendMessage(user.orgId, id, user.userId, body.body, body.attachments);
  }

  // Signed download for a file attached to a thread the caller participates in.
  // Deliberately NOT /files/:id/sign-download, which is owner-or-management only
  // — a parent must be able to open a video their teacher sent without owning
  // the file. The thread membership check is the authorisation.
  @Get(':id/attachments/:fileId')
  @Roles('student')
  signAttachment(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    return this.messaging.signThreadAttachment(user.orgId, id, user.userId, fileId);
  }
}
