import { Controller, Get, Post, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ResourcesService } from './resources.service';
import { CreateResourceDto } from './dto/create-resource.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '@music-life/types';

@Controller('resources')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ResourcesController {
  constructor(private readonly resources: ResourcesService) {}

  @Get()
  @Roles('student')
  findAll(
    @CurrentUser() user: RequestUser,
    @Query('search') search?: string,
    @Query('instrument') instrument?: string,
    @Query('teacherId') teacherId?: string,
    @Query('studentId') studentId?: string,
  ) {
    return this.resources.findAll(user.orgId, user.role, user.userId, { search, instrument, teacherId, studentId });
  }

  @Post()
  @Roles('teacher')
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateResourceDto) {
    return this.resources.create(user.orgId, user.userId, user.role, dto);
  }

  @Delete(':id')
  @Roles('teacher')
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.resources.remove(user.orgId, id);
  }
}
