import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { MarkAttendanceDto } from './dto/mark-attendance.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '@music-life/types';

@Controller('lessons')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post(':id/attendance')
  @Roles('teacher')
  mark(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: MarkAttendanceDto) {
    return this.attendance.markAttendance(user.orgId, id, dto, user.userId, { role: user.role, userId: user.userId });
  }

  @Get(':id/attendance')
  @Roles('teacher')
  get(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.attendance.getAttendance(user.orgId, id, { role: user.role, userId: user.userId });
  }
}
