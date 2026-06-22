import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DbService } from '../db/db.service';
import { eq } from 'drizzle-orm';
import { rooms } from '@music-life/db';
import type { RequestUser } from '@music-life/types';

@Controller('rooms')
@UseGuards(JwtAuthGuard)
export class RoomsController {
  constructor(private readonly db: DbService) {}

  @Get()
  findAll(@CurrentUser() user: RequestUser) {
    return this.db.db.query.rooms.findMany({
      where: eq(rooms.organizationId, user.orgId),
      orderBy: (r, { asc }) => [asc(r.name)],
    });
  }
}
