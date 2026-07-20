import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { gte, lte, eq, and } from 'drizzle-orm';
import { lessons, students, families } from '@music-life/db';
import { DbService } from '../db/db.service';
import { NotificationsService } from './notifications.service';
import { withAdvisoryLock } from '../common/cron-lock';

@Injectable()
export class ReminderWorker {
  private readonly logger = new Logger(ReminderWorker.name);
  private static readonly LOCK_KEY = 811002;

  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationsService,
  ) {}

  // Read-only/idempotent (sends 24h reminders), so it always runs — no opt-in flag.
  @Cron(CronExpression.EVERY_HOUR)
  async run() {
    await withAdvisoryLock(this.db.db, ReminderWorker.LOCK_KEY, () => this.scanReminders());
  }

  private async scanReminders() {
    const now = new Date();

    // 24h window: lessons starting between 23h and 25h from now
    const window24hStart = new Date(now.getTime() + 23 * 3600000);
    const window24hEnd = new Date(now.getTime() + 25 * 3600000);

    const upcomingLessons = await this.db.db.query.lessons.findMany({
      where: and(
        eq(lessons.status, 'scheduled'),
        gte(lessons.startsAt, window24hStart),
        lte(lessons.startsAt, window24hEnd),
      ),
      with: {
        student: { with: { family: { columns: { id: true, email: true, phone: true } } } },
        teacher: { columns: { id: true, firstName: true, lastName: true } },
      },
    });

    for (const lesson of upcomingLessons) {
      const hoursUntil = (lesson.startsAt.getTime() - now.getTime()) / 3600000;
      const family = (lesson.student as { family?: { email: string | null; phone: string | null } })?.family;

      if (hoursUntil >= 23 && hoursUntil <= 25 && family?.email) {
        await this.notifications.trigger('lesson.reminder_24h', {
          orgId: lesson.organizationId,
          email: family.email,
          body: `Your lesson is tomorrow at ${lesson.startsAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`,
        });
      }
    }

    this.logger.log(`Reminder scan: ${upcomingLessons.length} upcoming lessons checked`);
  }
}
