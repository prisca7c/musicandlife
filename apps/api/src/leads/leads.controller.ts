import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '@music-life/types';
import { CreateLeadDto, UpdateLeadDto } from './dto/lead.dto';

@Controller('leads')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @Roles('admin')
  findAll(@CurrentUser() user: RequestUser) { return this.leads.findAll(user.orgId); }

  @Post()
  @Roles('admin')
  create(@CurrentUser() user: RequestUser, @Body() body: CreateLeadDto) {
    return this.leads.create(user.orgId, body);
  }

  @Patch(':id')
  @Roles('admin')
  update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() body: UpdateLeadDto) {
    return this.leads.update(user.orgId, id, body);
  }
}
