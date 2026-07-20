import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AttendanceService } from './attendance.service';
import { DbService } from '../db/db.service';
import { withAdvisoryLock } from '../common/cron-lock';

const DEFAULT_GRACE_HOURS = 24;

@Injectable()
export class AttendanceAutocompleteWorker {
  private readonly logger = new Logger(AttendanceAutocompleteWorker.name);
  private static readonly LOCK_KEY = 811004;

  constructor(
    private readonly attendance: AttendanceService,
    private readonly db: DbService,
  ) {}

  // Marks overdue lessons present — real financial side-effects (charges families,
  // pays teachers) — so it stays opt-in (ATTENDANCE_AUTOCOMPLETE_ENABLED).
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async run() {
    if (process.env.ATTENDANCE_AUTOCOMPLETE_ENABLED !== 'true') return;
    const graceHours = Number(process.env.ATTENDANCE_GRACE_HOURS) || DEFAULT_GRACE_HOURS;
    await withAdvisoryLock(this.db.db, AttendanceAutocompleteWorker.LOCK_KEY, async () => {
      const r = await this.attendance.autoCompleteOverdue(graceHours);
      this.logger.log(
        `Attendance auto-complete scan: ${r.candidates} overdue across ${r.orgs} org(s) — ${r.marked} marked present, ${r.skipped} skipped, ${r.failed} failed`,
      );
    });
  }
}
