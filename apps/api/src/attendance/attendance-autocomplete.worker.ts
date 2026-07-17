import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { AttendanceService } from './attendance.service';
import { getRedisConnection } from '../common/redis-connection';

const DEFAULT_GRACE_HOURS = 24;

@Injectable()
export class AttendanceAutocompleteWorker implements OnModuleInit {
  private readonly logger = new Logger(AttendanceAutocompleteWorker.name);
  private queue?: Queue;

  constructor(private readonly attendance: AttendanceService) {}

  onModuleInit() {
    // Like the recurrence/invoice workers, this writes real financial side-effects
    // (marks lessons completed → charges families, pays teachers) every run, so it
    // must be explicitly opted into rather than firing just because the API booted.
    if (process.env.ATTENDANCE_AUTOCOMPLETE_ENABLED !== 'true') {
      this.logger.warn('ATTENDANCE_AUTOCOMPLETE_ENABLED not set to "true" — attendance auto-complete disabled');
      return;
    }

    const conn = getRedisConnection();
    if (!conn) {
      this.logger.warn('REDIS_URL not configured — attendance auto-complete disabled');
      return;
    }

    const graceHours = Number(process.env.ATTENDANCE_GRACE_HOURS) || DEFAULT_GRACE_HOURS;

    try {
      this.queue = new Queue('attendance-autocomplete', { connection: conn });

      this.queue.add('scan', {}, {
        repeat: { every: 86400000 },
        jobId: 'attendance-autocomplete-scan',
      }).catch(() => {}); // ignore if already exists

      new Worker('attendance-autocomplete', async (job) => {
        if (job.name === 'scan') {
          const r = await this.attendance.autoCompleteOverdue(graceHours);
          this.logger.log(
            `Attendance auto-complete scan: ${r.candidates} overdue across ${r.orgs} org(s) — ${r.marked} marked present, ${r.skipped} skipped, ${r.failed} failed`,
          );
        }
      }, { connection: conn, concurrency: 1 });

      this.logger.log(`Attendance auto-complete worker started (grace ${graceHours}h)`);
    } catch (err) {
      this.logger.warn(`Attendance auto-complete worker failed to start: ${err}`);
    }
  }
}
