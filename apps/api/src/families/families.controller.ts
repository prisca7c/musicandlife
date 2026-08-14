import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { FamiliesService } from './families.service';
import { CreateFamilyDto } from './dto/create-family.dto';
import { UpdateFamilyDto } from './dto/update-family.dto';
import { BulkInvoicingSettingsDto } from './dto/bulk-invoicing-settings.dto';

class MergeFamilyDto {
  // The duplicate family to absorb into the one named in the URL.
  @IsUUID() sourceFamilyId!: string;
}
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
  @Roles('admin')
  findAll(@CurrentUser() user: RequestUser, @Query('search') search?: string) {
    return this.families.findAll(user.orgId, search);
  }

  @Post()
  @Roles('admin')
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateFamilyDto) {
    return this.families.create(user.orgId, dto);
  }

  // Declared before ':id' so it isn't shadowed by the param route below.
  @Patch('bulk-invoicing-settings')
  @Roles('admin')
  bulkInvoicingSettings(@CurrentUser() user: RequestUser, @Body() dto: BulkInvoicingSettingsDto) {
    return this.families.bulkApplyInvoicingSettings(user.orgId, dto.familyIds, dto.settings);
  }

  @Get(':id')
  @Roles('admin')
  findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.families.findOne(user.orgId, id);
  }

  @Patch(':id')
  @Roles('admin')
  update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateFamilyDto) {
    return this.families.update(user.orgId, id, dto);
  }

  @Get(':id/ledger')
  @Roles('admin')
  getLedger(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.families.getLedger(user.orgId, id);
  }

  // Merge a duplicate family into this one (`:id` is the family that survives).
  // Destructive — gated to managers and above.
  @Post(':id/merge')
  @Roles('admin')
  merge(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: MergeFamilyDto) {
    return this.families.mergeFamilies(user.orgId, id, dto.sourceFamilyId);
  }
}
