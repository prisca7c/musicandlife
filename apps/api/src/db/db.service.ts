import { Injectable } from '@nestjs/common';
import { createDb, type Db } from '@music-life/db';

@Injectable()
export class DbService {
  readonly db: Db;

  constructor() {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    this.db = createDb(process.env.DATABASE_URL);
  }
}
