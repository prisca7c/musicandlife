import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SchedulingService } from './scheduling.service';
import { DbService } from '../db/db.service';
import { withAdvisoryLock } from '../common/cron-lock';

@Injectable()
export class RecurrenceWorker {
  private readonly logger = new Logger(RecurrenceWorker.name);
  private static readonly LOCK_KEY = 811001;

  constructor(
    private readonly scheduling: SchedulingService,
    private readonly db: DbService,
  ) {}

  // Tops up the recurring-lesson generation window once a day. This bulk-inserts
  // real lessons, so it stays opt-in (RECURRENCE_WORKER_ENABLED) — a local
  // `pnpm dev` must never write into whichever DB DATABASE_URL points at.
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async run() {
    if (process.env.RECURRENCE_WORKER_ENABLED !== 'true') return;
    await withAdvisoryLock(this.db.db, RecurrenceWorker.LOCK_KEY, async () => {
      const r = await this.scheduling.materializeAllRecurring();
      this.logger.log(
        `Recurrence scan: ${r.created} lessons created, ${r.skippedExisting} already existed, ${r.skippedConflicts} conflicts skipped`,
      );
    });
  }
}
