import { Controller, Patch, Body, Param, UseGuards } from '@nestjs/common';
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
  @Roles('receptionist')
  update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateEnrollmentDto) {
    return this.enrollments.update(user.orgId, id, dto);
  }
}
