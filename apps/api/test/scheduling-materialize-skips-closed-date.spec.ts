import { SchedulingService } from '../src/scheduling/scheduling.service';

/**
 * A closureDates row (written by deleteLessonsForDay for a FUTURE date — see
 * scheduling-delete-lessons-for-day.spec.ts) must stop the nightly recurrence
 * worker from regenerating a weekly series' slot on that date. Without this,
 * bulk-deleting a future closure day would just have the lesson reappear
 * before the closure day arrives, since materializeEnrollment's dedup
 * otherwise only checks whether a `lessons` row currently occupies the slot.
 */

describe('SchedulingService.materializeEnrollment — skips a date marked closed', () => {
  it('skips the one occurrence that falls on a closure date, creates the others', async () => {
    const enrollment = {
      id: 'enr-1', organizationId: 'org-1', studentId: 'stu-1', teacherId: null, termId: null,
      defaultDuration: 30,
      scheduleRule: { weekday: 'monday', startTime: '10:00' },
    };
    const createLesson = jest.fn(async (_orgId: string, dto: { startsAt: string }) => ({ id: 'les-new', dto }));
    const db = {
      db: {
        query: {
          enrollments: { findFirst: async () => enrollment },
          lessons: {
            findFirst: async () => undefined, // no earliest lesson yet — "now" isn't floored
            findMany: async () => [], // nothing already occupies a slot in the window
          },
          closureDates: { findMany: async () => [{ date: '2026-09-14' }] }, // one Monday closed
        },
        update: () => ({ set: () => ({ where: async () => undefined }) }),
      },
    };
    const svc = new SchedulingService(db as never, null as never, null as never);
    Object.assign(svc as object, { getOrgTimezone: async () => 'Europe/London', createLesson });

    // 2026-09-14 is a Monday; weeks:2 from that date yields two weekly
    // occurrences within the window (14th, 21st) — the 14th is the one
    // marked closed.
    const result = await svc.materializeEnrollment('org-1', 'enr-1', { weeks: 2, fromDate: '2026-09-14' });

    expect(result.skippedClosed).toBe(1);
    expect(result.created).toBe(1);
    expect(createLesson).toHaveBeenCalledTimes(1);
    // Never asked to create a lesson on the closed date.
    for (const [, dto] of createLesson.mock.calls) {
      expect(dto.startsAt.startsWith('2026-09-14')).toBe(false);
    }
  });
});
