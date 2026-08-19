import { Controller, Patch, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { EnrollmentsService } from './enrollments.service';
import { UpdateEnrollmentDto } from './dto/update-enrollment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '@music-life/types';

@Controller('enrollments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Patch(':id')
  @Roles('admin')
  update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateEnrollmentDto) {
    return this.enrollments.update(user.orgId, id, dto);
  }

  // Stop an ongoing weekly series (clear the rule + cancel future lessons).
  @Post(':id/stop-recurring')
  @Roles('admin')
  stopRecurring(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.enrollments.stopRecurring(user.orgId, id);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.enrollments.remove(user.orgId, id);
  }
}
