import { BadRequestException } from '@nestjs/common';
import { SchedulingService } from '../src/scheduling/scheduling.service';

/**
 * Family self-booking = instant-book the 1st choice + a teacher veto.
 *
 * The rules that carry money or fairness:
 *  - the 1st choice must be >=48h out (so the teacher has room to veto);
 *  - a teacher DECLINE cancels as `cancelled_teacher` (no charge, no credit lost,
 *    teacher unpaid) and, for a recurring booking, clears the weekly rule so the
 *    generator stops the whole series;
 *  - CONFIRM keeps the 1st choice (Accept) or moves the lesson to one of the
 *    family's other ranked times (Move) — never to a time they didn't offer.
 *
 * The scheduling primitives (createLesson / directReschedule / cancelLesson /
 * materializeEnrollment) are already covered elsewhere, so they're stubbed here
 * and we assert this layer calls them with the right arguments.
 */

const iso = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * 3600000).toISOString();

interface UpdateRec { set: Record<string, unknown> }

function makeService() {
  const inserted: Record<string, unknown>[] = [];
  const updates: UpdateRec[] = [];

  // Minimal chainable drizzle mock. `.where(...)` is awaitable (returns undefined)
  // and also exposes `.returning()` (the guarded claim reads back a row), so both
  // `await update().set().where()` and `await update().set().where().returning()`
  // work off the same object.
  const whereChain = {
    returning: async () => [{ id: 'req-1' }],
    then: (resolve: (v: unknown) => unknown) => resolve(undefined),
  };
  const db = {
    db: {
      query: {
        lessonRequests: { findFirst: jest.fn() },
        // Booking checks the enrolment isn't a group class; decline of a recurring
        // series scans for the future rows it materialised.
        enrollments: { findFirst: jest.fn().mockResolvedValue({ lessonType: 'private' }) },
        lessons: { findMany: jest.fn().mockResolvedValue([]) },
      },
      insert: jest.fn(() => ({
        values: (v: Record<string, unknown>) => { inserted.push(v); return { returning: async () => [{ ...v, id: 'req-1' }] }; },
      })),
      update: jest.fn(() => ({
        set: (s: Record<string, unknown>) => { updates.push({ set: s }); return { where: () => whereChain }; },
      })),
    },
  };

  const svc = Object.create(SchedulingService.prototype) as SchedulingService;
  const s = svc as unknown as Record<string, unknown>;
  s.db = db;
  s.logger = { warn: jest.fn(), log: jest.fn() };
  s.getOrgTimezone = jest.fn().mockResolvedValue('Europe/London');
  s.createLesson = jest.fn().mockResolvedValue({ id: 'lesson-1' });
  s.directReschedule = jest.fn().mockResolvedValue({});
  s.cancelLesson = jest.fn().mockResolvedValue({});
  s.materializeEnrollment = jest.fn().mockResolvedValue({ created: 1 });
  // The lesson under review is still scheduled unless a test says otherwise.
  s.getLesson = jest.fn().mockResolvedValue({ id: 'lesson-1', status: 'scheduled', studentId: 'stu-1' });
  s.notifyRecurringCancelled = jest.fn().mockResolvedValue(undefined);
  s.notifyRecurringMoved = jest.fn().mockResolvedValue(undefined);
  // A moved series lands in a free slot within the teacher's hours by default.
  s.teacherUnavailableReason = jest.fn().mockResolvedValue(null);
  s.hasConflict = jest.fn().mockResolvedValue(false);
  s.resolveStaffId = jest.fn().mockResolvedValue('staff-1');

  return { svc, s, db, inserted, updates };
}

const staff = { role: 'receptionist', userId: 'u-staff' } as never;

describe('SchedulingService.createFamilyBooking', () => {
  it('rejects a 1st choice less than 48h away and books nothing', async () => {
    const { svc, s } = makeService();
    await expect(
      svc.createFamilyBooking('org-1', {
        studentId: 'stu-1', teacherId: 't-1', enrollmentId: 'en-1',
        startsAt: iso(2), duration: 60,
      }, 'u-1'),
    ).rejects.toThrow(BadRequestException);
    expect(s.createLesson).not.toHaveBeenCalled();
  });

  it('instant-books the 1st choice and opens an auto_confirmed review', async () => {
    const { svc, s, inserted } = makeService();
    const first = iso(72);
    const res = await svc.createFamilyBooking('org-1', {
      studentId: 'stu-1', teacherId: 't-1', enrollmentId: 'en-1',
      startsAt: first, startsAt2: iso(96), duration: 45,
    }, 'u-1');

    expect(s.createLesson).toHaveBeenCalledTimes(1);
    expect((s.createLesson as jest.Mock).mock.calls[0][1]).toMatchObject({ startsAt: first, duration: 45 });
    expect(res.lesson).toEqual({ id: 'lesson-1' });
    expect(inserted[0]).toMatchObject({ status: 'auto_confirmed', isRecurring: false, createdLessonId: 'lesson-1' });
    // Not recurring ⇒ no schedule rule written, no materialise.
    expect(s.materializeEnrollment).not.toHaveBeenCalled();
  });

  it('a recurring booking records the weekly rule and materialises the series', async () => {
    const { svc, s, updates } = makeService();
    await svc.createFamilyBooking('org-1', {
      studentId: 'stu-1', teacherId: 't-1', enrollmentId: 'en-1',
      startsAt: iso(72), duration: 60, recurring: true,
    }, 'u-1');

    const ruleWrite = updates.find(u => 'scheduleRule' in u.set);
    expect(ruleWrite).toBeDefined();
    const rule = ruleWrite!.set.scheduleRule as { weekday: string; startTime: string };
    expect(rule.weekday).toMatch(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
    expect(rule.startTime).toMatch(/^\d{2}:\d{2}$/);
    expect(s.materializeEnrollment).toHaveBeenCalledWith('org-1', 'en-1');
  });

  it('stores a recurring end date on the weekly rule when given', async () => {
    const { svc, updates } = makeService();
    await svc.createFamilyBooking('org-1', {
      studentId: 'stu-1', teacherId: 't-1', enrollmentId: 'en-1',
      startsAt: iso(72), duration: 60, recurring: true, recurringEndDate: '2026-12-31',
    }, 'u-1');
    const ruleWrite = updates.find(u => 'scheduleRule' in u.set);
    expect((ruleWrite!.set.scheduleRule as { endDate?: string }).endDate).toBe('2026-12-31');
  });

  it('rejects a recurring end date that falls before the first lesson', async () => {
    const { svc, s } = makeService();
    await expect(
      svc.createFamilyBooking('org-1', {
        studentId: 'stu-1', teacherId: 't-1', enrollmentId: 'en-1',
        startsAt: iso(72), duration: 60, recurring: true, recurringEndDate: '2000-01-01',
      }, 'u-1'),
    ).rejects.toThrow(BadRequestException);
    // The lesson is instant-booked before the rule is validated, so createLesson
    // ran — but no schedule rule should have been written.
    expect(s.materializeEnrollment).not.toHaveBeenCalled();
  });

  it('rejects a group enrolment — group classes are not self-bookable', async () => {
    const { svc, s, db } = makeService();
    (db.db.query.enrollments.findFirst as jest.Mock).mockResolvedValue({ lessonType: 'group' });
    await expect(
      svc.createFamilyBooking('org-1', {
        studentId: 'stu-1', teacherId: 't-1', enrollmentId: 'en-1',
        startsAt: iso(72), duration: 60,
      }, 'u-1'),
    ).rejects.toThrow(BadRequestException);
    expect(s.createLesson).not.toHaveBeenCalled();
  });
});

describe('SchedulingService.decideLessonRequest — auto_confirmed (family veto)', () => {
  const baseReq = () => ({
    id: 'req-1', organizationId: 'org-1', status: 'auto_confirmed',
    teacherId: 't-1', studentId: 'stu-1', enrollmentId: 'en-1',
    createdLessonId: 'lesson-1', isRecurring: false,
    proposedStartsAt: new Date(iso(72)),
    proposedStartsAt2: new Date(iso(96)),
    proposedStartsAt3: null,
  });

  it('DECLINE cancels the lesson as cancelled_teacher (no charge/pay)', async () => {
    const { svc, s, db } = makeService();
    (db.db.query.lessonRequests.findFirst as jest.Mock).mockResolvedValue(baseReq());

    const res = await svc.decideLessonRequest('org-1', 'req-1', 'declined', staff, undefined, 'busy');
    expect(res).toMatchObject({ status: 'declined' });
    expect((s.cancelLesson as jest.Mock).mock.calls[0][2]).toMatchObject({ reason: 'cancelled_teacher' });
    expect(s.directReschedule).not.toHaveBeenCalled();
  });

  it('DECLINE of a recurring booking also clears the weekly rule', async () => {
    const { svc, db, updates } = makeService();
    (db.db.query.lessonRequests.findFirst as jest.Mock).mockResolvedValue({ ...baseReq(), isRecurring: true });

    await svc.decideLessonRequest('org-1', 'req-1', 'declined', staff, undefined, undefined);
    expect(updates.some(u => u.set.scheduleRule === null)).toBe(true);
  });

  it('DECLINE of a recurring booking cancels the already-materialised future weeks', async () => {
    const { svc, s, db, updates } = makeService();
    (db.db.query.lessonRequests.findFirst as jest.Mock).mockResolvedValue({ ...baseReq(), isRecurring: true });
    // Weeks 2-3 were materialised at booking time and are still on the calendar.
    (db.db.query.lessons.findMany as jest.Mock).mockResolvedValue([
      { id: 'lesson-2', studentId: 'stu-1', startsAt: new Date(iso(240)) },
      { id: 'lesson-3', studentId: 'stu-1', startsAt: new Date(iso(408)) },
    ]);

    await svc.decideLessonRequest('org-1', 'req-1', 'declined', staff, undefined, undefined);
    // A bulk status flip to cancelled_teacher for the future rows, plus one notice.
    expect(updates.some(u => u.set.status === 'cancelled_teacher')).toBe(true);
    expect(s.notifyRecurringCancelled).toHaveBeenCalledTimes(1);
  });

  it('MOVE SERIES retargets the weekly rule, drops old weeks, and regenerates', async () => {
    const { svc, s, db, updates } = makeService();
    (db.db.query.lessonRequests.findFirst as jest.Mock).mockResolvedValue({ ...baseReq(), isRecurring: true });
    (db.db.query.enrollments.findFirst as jest.Mock).mockResolvedValue({ scheduleRule: { weekday: 'monday', startTime: '09:00', endDate: '2026-12-31' } });

    const res = await svc.moveRecurringSeries('org-1', 'req-1', '2026-09-03T15:00:00', staff);
    expect(res).toMatchObject({ status: 'confirmed' });
    // Old future occurrences cancelled, then a fresh rule written (end date kept).
    expect(updates.some(u => u.set.status === 'cancelled_teacher')).toBe(true);
    const ruleWrite = updates.find(u => 'scheduleRule' in u.set);
    expect((ruleWrite!.set.scheduleRule as { endDate?: string }).endDate).toBe('2026-12-31');
    expect(s.materializeEnrollment).toHaveBeenCalledWith('org-1', 'en-1');
    expect(s.notifyRecurringMoved).toHaveBeenCalledTimes(1);
  });

  it('MOVE SERIES rejects a non-recurring booking', async () => {
    const { svc, db } = makeService();
    (db.db.query.lessonRequests.findFirst as jest.Mock).mockResolvedValue(baseReq()); // isRecurring: false
    await expect(
      svc.moveRecurringSeries('org-1', 'req-1', '2026-09-03T15:00:00', staff),
    ).rejects.toThrow(BadRequestException);
  });

  it('MOVE SERIES rejects a clashing new time', async () => {
    const { svc, s, db } = makeService();
    (db.db.query.lessonRequests.findFirst as jest.Mock).mockResolvedValue({ ...baseReq(), isRecurring: true });
    (s.hasConflict as jest.Mock).mockResolvedValue(true);
    await expect(
      svc.moveRecurringSeries('org-1', 'req-1', '2026-09-03T15:00:00', staff),
    ).rejects.toThrow(BadRequestException);
    expect(s.materializeEnrollment).not.toHaveBeenCalled();
  });

  it('resolves the request without acting when the family already cancelled the lesson', async () => {
    const { svc, s, db } = makeService();
    (db.db.query.lessonRequests.findFirst as jest.Mock).mockResolvedValue(baseReq());
    (s.getLesson as jest.Mock).mockResolvedValue({ id: 'lesson-1', status: 'cancelled_family', studentId: 'stu-1' });

    await expect(
      svc.decideLessonRequest('org-1', 'req-1', 'confirmed', staff),
    ).rejects.toThrow(BadRequestException);
    // Neither Accept nor Move touched the dead lesson.
    expect(s.cancelLesson).not.toHaveBeenCalled();
    expect(s.directReschedule).not.toHaveBeenCalled();
  });

  it('ACCEPT (no chosen time) keeps the 1st choice — no reschedule', async () => {
    const { svc, s, db } = makeService();
    (db.db.query.lessonRequests.findFirst as jest.Mock).mockResolvedValue(baseReq());

    const res = await svc.decideLessonRequest('org-1', 'req-1', 'confirmed', staff);
    expect(res).toMatchObject({ status: 'confirmed' });
    expect(s.directReschedule).not.toHaveBeenCalled();
  });

  it('MOVE to a ranked alternative reschedules the booked lesson', async () => {
    const { svc, s, db } = makeService();
    const req = baseReq();
    (db.db.query.lessonRequests.findFirst as jest.Mock).mockResolvedValue(req);

    await svc.decideLessonRequest('org-1', 'req-1', 'confirmed', staff, req.proposedStartsAt2!.toISOString());
    expect(s.directReschedule).toHaveBeenCalledTimes(1);
    expect((s.directReschedule as jest.Mock).mock.calls[0][2]).toBe(req.proposedStartsAt2!.toISOString());
  });

  it('rejects a chosen time the family never offered', async () => {
    const { svc, s, db } = makeService();
    (db.db.query.lessonRequests.findFirst as jest.Mock).mockResolvedValue(baseReq());

    await expect(
      svc.decideLessonRequest('org-1', 'req-1', 'confirmed', staff, iso(500)),
    ).rejects.toThrow(BadRequestException);
    expect(s.directReschedule).not.toHaveBeenCalled();
  });
});
