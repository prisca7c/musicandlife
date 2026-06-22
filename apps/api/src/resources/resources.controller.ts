import { Controller, Get, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
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
  findAll(@CurrentUser() user: RequestUser) {
    return this.resources.findAll(user.orgId, user.role);
  }

  @Post()
  @Roles('teacher')
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateResourceDto) {
    return this.resources.create(user.orgId, user.userId, dto);
  }

  @Delete(':id')
  @Roles('teacher')
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.resources.remove(user.orgId, id);
  }
}
