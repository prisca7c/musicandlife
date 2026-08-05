import { SchedulingService } from '../src/scheduling/scheduling.service';

/**
 * The nightly recurrence worker tops up each enrolment's weekly lessons. Its
 * dedup used to key on the exact starts_at of existing lessons — so rescheduling
 * a recurring lesson off its weekly slot left that slot looking empty, and the
 * next run regenerated a DUPLICATE there (which autoCompleteOverdue then billed).
 *
 * The fix records each materialised lesson's canonical slot (series_slot_at),
 * which a reschedule never touches, and dedups on THAT. A legacy/one-off row
 * sitting exactly on a slot is adopted (stamped) so it's protected too.
 */

type Lesson = { id: string; startsAt: Date; seriesSlotAt: Date | null };

const TZ = 'UTC'; // avoid DST offsets — a slot at 16:00 wall-clock is 16:00Z
const RULE = { weekday: 'monday', startTime: '16:00' };

function makeService(existing: Lesson[]) {
  const created: Array<{ startsAt: string; seriesSlotAt?: Date }> = [];
  const stamped: Array<{ seriesSlotAt: Date }> = [];

  const db = {
    db: {
      query: {
        enrollments: {
          findFirst: async () => ({
            id: 'enr-1', organizationId: 'org-1', studentId: 'stu-1',
            teacherId: 'tea-1', defaultDuration: 30, termId: null, scheduleRule: RULE,
          }),
        },
        lessons: { findMany: async () => existing },
      },
      // Adopt path: update(lessons).set({ seriesSlotAt }).where(eq(id))
      update: () => ({
        set: (vals: { seriesSlotAt: Date }) => ({
          where: async () => { stamped.push({ seriesSlotAt: vals.seriesSlotAt }); },
        }),
      }),
    },
  };

  const svc = new SchedulingService(db as never, null as never);
  Object.assign(svc as object, {
    getOrgTimezone: async () => TZ,
    createLesson: async (_org: string, dto: { startsAt: string }, opts?: { seriesSlotAt?: Date }) => {
      created.push({ startsAt: dto.startsAt, seriesSlotAt: opts?.seriesSlotAt });
      return { id: `les-${created.length}` };
    },
  });
  return { svc, created, stamped };
}

const run = (svc: SchedulingService) =>
  (svc as never as { materializeEnrollment: (o: string, id: string, opts?: unknown) => Promise<unknown> })
    .materializeEnrollment('org-1', 'enr-1', { weeks: 4 });

describe('SchedulingService.materializeEnrollment — reschedule does not spawn a duplicate', () => {
  beforeAll(() => { jest.useFakeTimers().setSystemTime(new Date('2026-08-05T09:00:00Z')); });
  afterAll(() => { jest.useRealTimers(); });

  it('skips a slot whose lesson was rescheduled away (dedup on series_slot_at)', async () => {
    // First discover the real canonical slots the worker would generate.
    const probe = makeService([]);
    await run(probe.svc);
    expect(probe.created.length).toBeGreaterThan(0);
    const slot0 = probe.created[0]!.seriesSlotAt!;
    expect(slot0).toBeInstanceOf(Date);

    // A lesson for this slot exists but was MOVED to the next day — starts_at no
    // longer equals the slot; series_slot_at still pins it to the slot.
    const moved: Lesson = {
      id: 'les-moved',
      startsAt: new Date(slot0.getTime() + 86400000), // +1 day
      seriesSlotAt: slot0,
    };
    const { svc, created } = makeService([moved]);
    await run(svc);

    // The vacated slot must NOT be regenerated.
    const regenerated = created.some(c => c.seriesSlotAt?.getTime() === slot0.getTime());
    expect(regenerated).toBe(false);
    // Every other future slot is still generated (series continues), each stamped.
    expect(created.length).toBe(probe.created.length - 1);
    expect(created.every(c => c.seriesSlotAt instanceof Date)).toBe(true);
  });

  it('adopts a legacy/one-off lesson sitting on a slot (stamps it, no duplicate)', async () => {
    const probe = makeService([]);
    await run(probe.svc);
    const slot0 = probe.created[0]!.seriesSlotAt!;

    // Legacy row: sits exactly on the slot but was never stamped (series_slot_at null).
    const legacy: Lesson = { id: 'les-legacy', startsAt: slot0, seriesSlotAt: null };
    const { svc, created, stamped } = makeService([legacy]);
    await run(svc);

    // Not regenerated…
    const regenerated = created.some(c => c.seriesSlotAt?.getTime() === slot0.getTime());
    expect(regenerated).toBe(false);
    // …and adopted: stamped with the slot so a later reschedule can't vacate it.
    expect(stamped.some(s => s.seriesSlotAt.getTime() === slot0.getTime())).toBe(true);
  });

  it('still generates every slot for a brand-new enrolment', async () => {
    const probe = makeService([]);
    const { svc, created } = makeService([]);
    await run(svc);
    expect(created.length).toBeGreaterThan(0);
    // Each created lesson carries its canonical slot.
    expect(created.every(c => c.seriesSlotAt instanceof Date)).toBe(true);
    void probe;
  });
});
