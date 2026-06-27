import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { gte, lte, eq, and } from 'drizzle-orm';
import { lessons, students, families } from '@music-life/db';
import { DbService } from '../db/db.service';
import { NotificationsService } from './notifications.service';
import { getRedisConnection } from '../common/redis-connection';

@Injectable()
export class ReminderWorker implements OnModuleInit {
  private readonly logger = new Logger(ReminderWorker.name);
  private queue?: Queue;

  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    const conn = getRedisConnection();
    if (!conn) {
      this.logger.warn('REDIS_URL not configured — lesson reminders disabled');
      return;
    }

    try {
      this.queue = new Queue('reminders', { connection: conn });

      // Repeatable scanner: runs every hour
      this.queue.add('scan', {}, {
        repeat: { every: 3600000 },
        jobId: 'reminder-scan',
      }).catch(() => {}); // ignore if already exists

      new Worker('reminders', async (job) => {
        if (job.name === 'scan') await this.scanReminders();
      }, { connection: conn, concurrency: 1 });

      this.logger.log('Reminder worker started');
    } catch (err) {
      this.logger.warn(`Reminder worker failed to start: ${err}`);
    }
  }

  private async scanReminders() {
    const now = new Date();

    // 24h window: lessons starting between 23h and 25h from now
    const window24hStart = new Date(now.getTime() + 23 * 3600000);
    const window24hEnd = new Date(now.getTime() + 25 * 3600000);

    // 2h window: lessons starting between 1.75h and 2.25h from now
    const window2hStart = new Date(now.getTime() + 1.75 * 3600000);
    const window2hEnd = new Date(now.getTime() + 2.25 * 3600000);

    const upcomingLessons = await this.db.db.query.lessons.findMany({
      where: and(
        eq(lessons.status, 'scheduled'),
        gte(lessons.startsAt, window2hStart),
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

      if (hoursUntil >= 1.75 && hoursUntil <= 2.25 && family?.email) {
        await this.notifications.trigger('lesson.reminder_2h', {
          orgId: lesson.organizationId,
          email: family.email,
          body: `Lesson in 2 hours at ${lesson.startsAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`,
        });
      }
    }

    this.logger.log(`Reminder scan: ${upcomingLessons.length} upcoming lessons checked`);
  }
}
