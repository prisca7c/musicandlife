import { Controller, Get } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { sql } from 'drizzle-orm';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Get()
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  async ready() {
    try {
      await this.db.db.execute(sql`SELECT 1`);
      return { status: 'ready', db: 'ok', timestamp: new Date().toISOString() };
    } catch {
      return { status: 'degraded', db: 'unreachable', timestamp: new Date().toISOString() };
    }
  }

  @Get('live')
  live() {
    return { status: 'live', timestamp: new Date().toISOString() };
  }
}
