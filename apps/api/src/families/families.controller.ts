import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { FamiliesService } from './families.service';
import { CreateFamilyDto } from './dto/create-family.dto';
import { UpdateFamilyDto } from './dto/update-family.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '@music-life/types';

@Controller('families')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FamiliesController {
  constructor(private readonly families: FamiliesService) {}

  @Get()
  @Roles('receptionist')
  findAll(@CurrentUser() user: RequestUser, @Query('search') search?: string) {
    return this.families.findAll(user.orgId, search);
  }

  @Post()
  @Roles('receptionist')
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateFamilyDto) {
    return this.families.create(user.orgId, dto);
  }

  @Get(':id')
  @Roles('receptionist')
  findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.families.findOne(user.orgId, id);
  }

  @Patch(':id')
  @Roles('receptionist')
  update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateFamilyDto) {
    return this.families.update(user.orgId, id, dto);
  }

  @Get(':id/ledger')
  @Roles('receptionist')
  getLedger(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.families.getLedger(user.orgId, id);
  }
}
