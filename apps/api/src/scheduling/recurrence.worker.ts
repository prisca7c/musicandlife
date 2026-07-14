import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { SchedulingService } from './scheduling.service';
import { getRedisConnection } from '../common/redis-connection';

@Injectable()
export class RecurrenceWorker implements OnModuleInit {
  private readonly logger = new Logger(RecurrenceWorker.name);
  private queue?: Queue;

  constructor(private readonly scheduling: SchedulingService) {}

  onModuleInit() {
    // Unlike ReminderWorker (read-only/idempotent), this worker bulk-inserts real lessons
    // every run — it must be explicitly opted into, not run just because the API process
    // booted (e.g. a local `pnpm dev`), or it will write into whichever DB DATABASE_URL points at.
    if (process.env.RECURRENCE_WORKER_ENABLED !== 'true') {
      this.logger.warn('RECURRENCE_WORKER_ENABLED not set to "true" — recurring lesson generation disabled');
      return;
    }

    const conn = getRedisConnection();
    if (!conn) {
      this.logger.warn('REDIS_URL not configured — recurring lesson generation disabled');
      return;
    }

    try {
      this.queue = new Queue('recurrence', { connection: conn });

      // Repeatable scanner: runs daily, topping up the generation window
      this.queue.add('generate', {}, {
        repeat: { every: 86400000 },
        jobId: 'recurrence-generate',
      }).catch(() => {}); // ignore if already exists

      new Worker('recurrence', async (job) => {
        if (job.name === 'generate') {
          const r = await this.scheduling.materializeAllRecurring();
          this.logger.log(
            `Recurrence scan: ${r.created} lessons created, ${r.skippedExisting} already existed, ${r.skippedConflicts} conflicts skipped`,
          );
        }
      }, { connection: conn, concurrency: 1 });

      this.logger.log('Recurrence worker started');
    } catch (err) {
      this.logger.warn(`Recurrence worker failed to start: ${err}`);
    }
  }
}
