import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { families, guardians, lessons, organizations } from '@music-life/db';
import { DbService } from '../db/db.service';
import { buildIcs, type IcsEvent } from './ics';

// A feed is a rolling window, not the whole history: calendar clients re-fetch
// the entire document every refresh, so there's no reason to ship lessons from
// two years ago. Far enough back that last week stays visible.
const WINDOW_DAYS_BACK = 30;
const WINDOW_DAYS_FORWARD = 365;

@Injectable()
export class CalendarService {
  constructor(private readonly db: DbService) {}

  /** The family for a logged-in guardian. */
  private async familyForUser(userId: string, orgId: string) {
    const link = await this.db.db.query.guardians.findFirst({
      where: and(eq(guardians.userId, userId), eq(guardians.organizationId, orgId)),
      columns: { familyId: true },
    });
    if (!link) throw new NotFoundException('No family linked to this account');

    const family = await this.db.db.query.families.findFirst({
      where: and(eq(families.id, link.familyId), eq(families.organizationId, orgId)),
      columns: { id: true, name: true, calendarToken: true },
      with: { students: { columns: { id: true } } },
    });
    if (!family) throw new NotFoundException('Family not found');
    return family;
  }

  /**
   * The feed URL, minting the token on first use. Returned rather than emailed
   * so the secret only ever travels to an already-authenticated guardian.
   */
  async getOrCreateFeed(userId: string, orgId: string) {
    const family = await this.familyForUser(userId, orgId);
    let token = family.calendarToken;

    if (!token) {
      // 32 bytes of urlsafe randomness — this is the only thing standing
      // between the feed and the public internet.
      token = randomBytes(24).toString('base64url');
      await this.db.db
        .update(families)
        .set({ calendarToken: token, updatedAt: new Date() })
        .where(eq(families.id, family.id));
    }

    return { token, familyName: family.name };
  }

  /** Invalidates the old URL. Used when a family thinks the link has leaked. */
  async regenerate(userId: string, orgId: string) {
    const family = await this.familyForUser(userId, orgId);
    const token = randomBytes(24).toString('base64url');
    await this.db.db
      .update(families)
      .set({ calendarToken: token, updatedAt: new Date() })
      .where(eq(families.id, family.id));
    return { token, familyName: family.name };
  }

  /**
   * Render a family's feed from its token. Unauthenticated by design — a
   * calendar app cannot log in, so the token in the URL is the credential.
   * Only ever exposes lesson times, never money or notes.
   */
  async icsForToken(token: string): Promise<string> {
    // Reject obviously-malformed tokens before touching the database.
    if (!token || token.length < 16) throw new NotFoundException('Calendar not found');

    const family = await this.db.db.query.families.findFirst({
      where: eq(families.calendarToken, token),
      columns: { id: true, name: true, organizationId: true },
      with: { students: { columns: { id: true, firstName: true } } },
    });
    if (!family) throw new NotFoundException('Calendar not found');

    const org = await this.db.db.query.organizations.findFirst({
      where: eq(organizations.id, family.organizationId),
      columns: { name: true },
    });

    const studentIds = family.students.map((s) => s.id);
    const now = new Date();
    const from = new Date(now.getTime() - WINDOW_DAYS_BACK * 86400000);
    const to = new Date(now.getTime() + WINDOW_DAYS_FORWARD * 86400000);

    const rows = studentIds.length
      ? await this.db.db.query.lessons.findMany({
          where: and(
            eq(lessons.organizationId, family.organizationId),
            inArray(lessons.studentId, studentIds),
            gte(lessons.startsAt, from),
            lte(lessons.startsAt, to),
          ),
          with: {
            student: { columns: { firstName: true, lastName: true } },
            teacher: { columns: { firstName: true, lastName: true } },
            enrollment: { columns: { instrument: true, lessonType: true } },
          },
          orderBy: (l, { asc }) => [asc(l.startsAt)],
        })
      : [];

    const events: IcsEvent[] = rows.map((l) => {
      const student = (l as { student?: { firstName: string } }).student;
      const teacher = (l as { teacher?: { firstName: string; lastName: string } }).teacher;
      const enrollment = (l as { enrollment?: { instrument: string; lessonType: string } }).enrollment;

      const instrument = enrollment?.instrument ?? 'Music';
      const pretty = instrument.charAt(0).toUpperCase() + instrument.slice(1);
      const who = student?.firstName ? ` — ${student.firstName}` : '';

      const descriptionParts = [
        teacher ? `Teacher: ${teacher.firstName} ${teacher.lastName}` : null,
        enrollment?.lessonType === 'group' ? 'Group lesson' : null,
        l.meetingLink ? `Join: ${l.meetingLink}` : null,
      ].filter(Boolean) as string[];

      return {
        // The lesson id keeps the event stable, so rescheduling moves the entry
        // in the subscriber's calendar instead of adding a second one.
        uid: `lesson-${l.id}@musicandlife`,
        start: l.startsAt,
        durationMinutes: l.duration,
        summary: `${pretty} lesson${who}`,
        description: descriptionParts.join('\n') || undefined,
        location: l.meetingLink ?? undefined,
        cancelled: l.status.startsWith('cancelled'),
      };
    });

    return buildIcs({
      calendarName: `${org?.name ?? 'Music & Life'} — ${family.name}`,
      events,
    });
  }
}
