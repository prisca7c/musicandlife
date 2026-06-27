import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { eq, and, gte, lte } from 'drizzle-orm';
import { enrollments, lessons } from '@music-life/db';
import { DbService } from '../db/db.service';
import { SchedulingService } from './scheduling.service';
import { getRedisConnection } from '../common/redis-connection';

const WINDOW_WEEKS = 10;
const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

// Every weekly occurrence of `weekday`/`startTime` between `from` and `windowEnd`, inclusive,
// skipping the occurrence on `from`'s own date if its time-of-day has already passed.
export function occurrencesInWindow(from: Date, windowEnd: Date, weekday: string, startTime: string): Date[] {
  const targetDay = WEEKDAY_INDEX[weekday.toLowerCase()];
  if (targetDay === undefined) return [];
  const [hours, minutes] = startTime.split(':').map(Number);
  if (hours === undefined || minutes === undefined || Number.isNaN(hours) || Number.isNaN(minutes)) return [];

  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getDay() !== targetDay) cursor.setDate(cursor.getDate() + 1);

  const dates: Date[] = [];
  while (cursor <= windowEnd) {
    const occurrence = new Date(cursor);
    occurrence.setHours(hours, minutes, 0, 0);
    if (occurrence >= from) dates.push(occurrence);
    cursor.setDate(cursor.getDate() + 7);
  }
  return dates;
}

@Injectable()
export class RecurrenceWorker implements OnModuleInit {
  private readonly logger = new Logger(RecurrenceWorker.name);
  private queue?: Queue;

  constructor(
    private readonly db: DbService,
    private readonly scheduling: SchedulingService,
  ) {}

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
        if (job.name === 'generate') await this.generateUpcomingLessons();
      }, { connection: conn, concurrency: 1 });

      this.logger.log('Recurrence worker started');
    } catch (err) {
      this.logger.warn(`Recurrence worker failed to start: ${err}`);
    }
  }

  // orgId is exposed only so tests can scope a real-DB run to a throwaway test
  // organization instead of scanning every enrollment in the database.
  private async generateUpcomingLessons(orgId?: string) {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + WINDOW_WEEKS * 7 * 86400000);

    const activeEnrollments = await this.db.db.query.enrollments.findMany({
      where: orgId
        ? and(eq(enrollments.status, 'active'), eq(enrollments.organizationId, orgId))
        : eq(enrollments.status, 'active'),
    });

    let created = 0;
    let skippedExisting = 0;
    let skippedConflicts = 0;

    for (const enrollment of activeEnrollments) {
      const rule = enrollment.scheduleRule as { weekday: string; startTime: string } | null;
      if (!rule?.weekday || !rule?.startTime) continue;

      const occurrences = occurrencesInWindow(now, windowEnd, rule.weekday, rule.startTime);
      if (occurrences.length === 0) continue;

      const existing = await this.db.db.query.lessons.findMany({
        where: and(
          eq(lessons.enrollmentId, enrollment.id),
          gte(lessons.startsAt, now),
          lte(lessons.startsAt, windowEnd),
        ),
        columns: { startsAt: true },
      });
      const existingTimes = new Set(existing.map((l) => l.startsAt.getTime()));

      for (const occurrence of occurrences) {
        if (existingTimes.has(occurrence.getTime())) {
          skippedExisting++;
          continue;
        }

        try {
          await this.scheduling.createLesson(enrollment.organizationId, {
            studentId: enrollment.studentId,
            startsAt: occurrence.toISOString(),
            duration: enrollment.defaultDuration,
            teacherId: enrollment.teacherId ?? undefined,
            enrollmentId: enrollment.id,
            termId: enrollment.termId ?? undefined,
          });
          created++;
        } catch (err) {
          // Most commonly a teacher/room conflict from checkConflicts() — log and move on
          // so admin can manually resolve it rather than the scan silently dropping it.
          skippedConflicts++;
          this.logger.warn(
            `Skipped recurring lesson for enrollment ${enrollment.id} at ${occurrence.toISOString()}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    }

    this.logger.log(
      `Recurrence scan: ${created} lessons created, ${skippedExisting} already existed, ${skippedConflicts} conflicts skipped`,
    );
  }
}
