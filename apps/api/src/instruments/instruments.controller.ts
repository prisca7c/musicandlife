import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { InstrumentsService } from './instruments.service';
import { CreateInstrumentDto, UpdateInstrumentDto } from './dto/instrument.dto';
import type { RequestUser } from '@music-life/types';

// The registration form is unauthenticated, so the list it renders has to be
// readable without a token. Same single-tenant slug the other public
// registration endpoints use.
@Controller('public/instruments')
export class PublicInstrumentsController {
  constructor(private readonly instruments: InstrumentsService) {}

  @Get()
  list() {
    return this.instruments.publicList('music-and-life');
  }
}

@Controller('instruments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InstrumentsController {
  constructor(private readonly instruments: InstrumentsService) {}

  // Anyone who can see students needs to read the list (pickers, filters).
  @Get()
  @Roles('teacher')
  list(@CurrentUser() user: RequestUser) {
    return this.instruments.list(user.orgId);
  }

  // Changing what the studio offers is an owner-level decision.
  @Post()
  @Roles('admin')
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateInstrumentDto) {
    return this.instruments.create(user.orgId, dto);
  }

  @Patch(':id')
  @Roles('admin')
  update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateInstrumentDto) {
    return this.instruments.update(user.orgId, id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.instruments.remove(user.orgId, id);
  }
}
