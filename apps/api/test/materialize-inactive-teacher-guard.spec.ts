import { BadRequestException } from '@nestjs/common';
import { SchedulingService } from '../src/scheduling/scheduling.service';

/**
 * materializeAllRecurring (the nightly worker) pre-filters enrolments whose
 * teacher has been deactivated — but materializeEnrollment is also reachable
 * directly via POST /lessons/recurring (booking a recurring lesson from the
 * calendar), which had no such guard. That let a receptionist materialize a
 * real, billable weekly series under a teacher who no longer works there.
 * The guard now lives inside materializeEnrollment itself so both callers
 * are covered by one check.
 */

const RULE = { weekday: 'monday', startTime: '16:00' };

function makeService(teacherStatus: string | null) {
  const db = {
    db: {
      query: {
        enrollments: {
          findFirst: async () => ({
            id: 'enr-1', organizationId: 'org-1', studentId: 'stu-1',
            teacherId: 'tea-1', defaultDuration: 30, termId: null, scheduleRule: RULE,
          }),
        },
        staffMembers: {
          findFirst: async () => (teacherStatus === null ? null : { status: teacherStatus }),
        },
        lessons: { findMany: async () => [] },
      },
    },
  };

  const svc = new SchedulingService(db as never, null as never);
  Object.assign(svc as object, {
    getOrgTimezone: async () => 'UTC',
    createLesson: async () => ({ id: 'les-1' }),
  });
  return svc;
}

const run = (svc: SchedulingService) =>
  (svc as never as { materializeEnrollment: (o: string, id: string, opts?: unknown) => Promise<unknown> })
    .materializeEnrollment('org-1', 'enr-1', { weeks: 1 });

describe('SchedulingService.materializeEnrollment — inactive teacher guard', () => {
  beforeAll(() => { jest.useFakeTimers().setSystemTime(new Date('2026-08-03T09:00:00Z')); });
  afterAll(() => { jest.useRealTimers(); });

  it('refuses to materialize lessons for a deactivated teacher', async () => {
    const svc = makeService('inactive');
    await expect(run(svc)).rejects.toThrow(BadRequestException);
  });

  it('still works normally for an active teacher', async () => {
    const svc = makeService('active');
    await expect(run(svc)).resolves.toBeDefined();
  });
});
