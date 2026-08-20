import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { PublicLibraryService } from './public-library.service';
import { SubscribeDto } from './dto/subscribe.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '@music-life/types';

@Controller()
export class PublicLibraryController {
  constructor(private readonly library: PublicLibraryService) {}

  // ─── Public (no auth) ───────────────────────────────────────────────────────
  @Get('public/library/terms')
  terms() {
    return this.library.getTerms();
  }

  @Post('public/library/subscribe')
  subscribe(@Body() dto: SubscribeDto) {
    return this.library.subscribe(dto);
  }

  // Token-gated: the magic link carries ?token=. Kept a GET so the browser can
  // open the library directly from the emailed link.
  @Get('public/library')
  view(@Query('token') token: string) {
    return this.library.getLibrary(token);
  }

  @Get('public/library/file/:resourceId')
  file(@Query('token') token: string, @Param('resourceId') resourceId: string) {
    return this.library.signFile(token, resourceId);
  }

  // ─── Staff admin ────────────────────────────────────────────────────────────
  @Get('resource-subscribers')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  list(@CurrentUser() user: RequestUser) {
    return this.library.list(user.orgId);
  }

  @Get('resource-subscribers/families')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  listFamilySubscriptions(@CurrentUser() user: RequestUser) {
    return this.library.listFamilySubscriptions(user.orgId);
  }

  @Post('resource-subscribers/:id/activate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  activate(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.library.activate(user.orgId, id);
  }

  @Post('resource-subscribers/:id/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  cancel(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.library.cancel(user.orgId, id);
  }
}
