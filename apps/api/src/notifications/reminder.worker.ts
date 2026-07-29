import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { gte, lte, eq, and } from 'drizzle-orm';
import { lessons, students, families, lessonRequests } from '@music-life/db';
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
    await withAdvisoryLock(this.db.db, ReminderWorker.LOCK_KEY, async () => {
      await this.scanReminders();
      await this.scanBookingReviews();
    });
  }

  // A family self-booking instant-books its 1st choice and stands whether or not
  // the teacher acts. This nudges the teacher — once — to confirm or move it if
  // they still haven't a day later. The 24–25h creation window is one hour wide,
  // so the hourly scan catches each request exactly once without a "reminded"
  // flag; the status filter stops it firing after the teacher has decided.
  private async scanBookingReviews() {
    const now = new Date();
    const windowStart = new Date(now.getTime() - 25 * 3600000);
    const windowEnd = new Date(now.getTime() - 24 * 3600000);

    const pending = await this.db.db.query.lessonRequests.findMany({
      where: and(
        eq(lessonRequests.status, 'auto_confirmed'),
        gte(lessonRequests.createdAt, windowStart),
        lte(lessonRequests.createdAt, windowEnd),
      ),
      with: {
        teacher: { columns: { firstName: true }, with: { user: { columns: { email: true } } } },
        student: { columns: { firstName: true, lastName: true } },
      },
    });

    let sent = 0;
    for (const req of pending) {
      const teacher = req.teacher as { user?: { email: string | null } | null } | null;
      const email = teacher?.user?.email?.trim();
      if (!email) continue;
      const student = req.student as { firstName: string | null; lastName: string | null } | null;
      const who = [student?.firstName, student?.lastName].filter(Boolean).join(' ') || 'A student';
      const when = req.proposedStartsAt.toLocaleString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      });
      await this.notifications.trigger('booking.review_reminder', {
        orgId: req.organizationId,
        email,
        body: `${who}'s lesson is booked for ${when}. Please confirm it, move it to one of their other choices, or decline.`,
      });
      sent++;
    }

    if (pending.length) this.logger.log(`Booking-review scan: ${pending.length} awaiting review, ${sent} reminders sent`);
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
        student: {
          columns: { email: true },
          with: { family: { columns: { id: true, email: true, phone: true, emailRemindersEnabled: true } } },
        },
        teacher: { columns: { id: true, firstName: true, lastName: true } },
      },
    });

    let sent = 0;
    for (const lesson of upcomingLessons) {
      const hoursUntil = (lesson.startsAt.getTime() - now.getTime()) / 3600000;
      if (hoursUntil < 23 || hoursUntil > 25) continue;

      const student = lesson.student as {
        email: string | null;
        family?: { email: string | null; emailRemindersEnabled: boolean } | null;
      };
      const family = student?.family;

      // Consent gate: the family opted out of reminders on the registration form.
      if (family && family.emailRemindersEnabled === false) continue;

      // Reminders go to the family/guardian AND, when the student gave their own
      // email (16+), to the student directly. Dedupe so a family that also uses
      // their child's address isn't emailed twice.
      const recipients = [...new Set(
        [family?.email, student?.email]
          .map((e) => e?.trim().toLowerCase())
          .filter((e): e is string => !!e),
      )];

      const at = lesson.startsAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      for (const email of recipients) {
        await this.notifications.trigger('lesson.reminder_24h', {
          orgId: lesson.organizationId,
          email,
          body: `Your lesson is tomorrow at ${at}.`,
        });
        sent++;
      }
    }

    this.logger.log(`Reminder scan: ${upcomingLessons.length} upcoming lessons, ${sent} reminders sent`);
  }
}
