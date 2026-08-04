import { BadRequestException } from '@nestjs/common';
import { SchedulingService } from '../src/scheduling/scheduling.service';

/**
 * decideRescheduleRequest validates the chosen time BEFORE the guarded claim,
 * precisely so a bad pick "fails cleanly without leaving the request marked
 * approved but the lesson unmoved" (its own comment). directReschedule — the
 * mutation it routes through — rejects a slot where THIS student is already
 * booked (even with another teacher). If the pre-check omits the student, that
 * clash slips past: the request is committed as 'approved', then directReschedule
 * throws, leaving the request permanently 'approved' with the lesson unmoved and
 * no way to re-decide it (status !== 'pending'). The pre-check must therefore
 * include the student, matching the mutation's own conflict check.
 */

type Row = Record<string, unknown>;

const TARGET = '2026-08-01T10:00:00.000Z'; // proposed slot: 10:00–10:30

// The lesson being rescheduled: student stu-1 with teacher tea-A.
const theLesson = { id: 'les-A', studentId: 'stu-1', teacherId: 'tea-A', duration: 30, status: 'scheduled', startsAt: new Date('2026-07-30T09:00:00.000Z') };

function makeService(overlappingLessons: Row[]) {
  const claimUpdate = jest.fn(() => ({
    set: () => ({ where: () => ({ returning: async () => [{ id: 'req-1' }] }) }),
  }));
  const db = {
    db: {
      query: {
        rescheduleRequests: {
          findFirst: async () => ({
            id: 'req-1',
            lessonId: 'les-A',
            status: 'pending',
            proposedStartsAt: new Date(TARGET),
            proposedStartsAt2: null,
            proposedStartsAt3: null,
            lesson: { teacherId: 'tea-A' },
          }),
        },
        // Read by the real checkConflicts (via hasConflict) to find clashes.
        lessons: { findMany: async () => overlappingLessons },
      },
      update: claimUpdate,
    },
  };
  const svc = new SchedulingService(db as never, null as never);
  // Stub the collaborators around the conflict check so the real hasConflict runs.
  const directReschedule = jest.fn(async () => ({ id: 'les-A' }));
  Object.assign(svc as object, {
    getLesson: async () => ({ ...theLesson }),
    getOrgTimezone: async () => 'Europe/London',
    teacherUnavailableReason: async () => null,
    directReschedule,
  });
  return { svc, claimUpdate, directReschedule };
}

const decide = (svc: SchedulingService) =>
  (svc as never as {
    decideRescheduleRequest: (
      o: string, id: string, d: 'approved' | 'denied', by: string,
      reason?: string, chosen?: string, actor?: { role: string; userId: string },
    ) => Promise<unknown>;
  }).decideRescheduleRequest('org-1', 'req-1', 'approved', 'mgr-1', undefined, undefined, { role: 'manager', userId: 'mgr-1' });

describe('SchedulingService.decideRescheduleRequest — student clash caught before claim', () => {
  it('rejects when the target overlaps the student\'s other lesson (different teacher) — and never claims the request', async () => {
    // stu-1 already has a 10:15–10:45 lesson with tea-B; the target is 10:00–10:30.
    const { svc, claimUpdate, directReschedule } = makeService([
      { id: 'les-B', startsAt: new Date('2026-08-01T10:15:00.000Z'), duration: 30, teacherId: 'tea-B', studentId: 'stu-1' },
    ]);
    await expect(decide(svc)).rejects.toBeInstanceOf(BadRequestException);
    // The pre-check fired before the guarded claim, so the request stays pending
    // (re-decidable) and the lesson was never touched.
    expect(claimUpdate).not.toHaveBeenCalled();
    expect(directReschedule).not.toHaveBeenCalled();
  });

  it('approves when the only overlap is a different student — claims then reschedules', async () => {
    // The overlapping lesson belongs to stu-9, not our stu-1, and to another teacher.
    const { svc, claimUpdate, directReschedule } = makeService([
      { id: 'les-C', startsAt: new Date('2026-08-01T10:15:00.000Z'), duration: 30, teacherId: 'tea-B', studentId: 'stu-9' },
    ]);
    await expect(decide(svc)).resolves.toEqual({ id: 'req-1', status: 'approved' });
    expect(claimUpdate).toHaveBeenCalledTimes(1);
    expect(directReschedule).toHaveBeenCalledWith('org-1', 'les-A', TARGET);
  });
});
