import { BadRequestException } from '@nestjs/common';
import { AttendanceService } from '../src/attendance/attendance.service';

/**
 * actualStartedAt/actualEndedAt feed payroll directly (computeRunItems pays the
 * elapsed minutes between them) and family billing never touches them, so
 * nothing else validates them. A teacher marking their OWN lesson could set any
 * pair of timestamps with no plausibility check — a 30-minute lesson recorded
 * as 5 hours would be paid as such. markAttendance now rejects an elapsed time
 * that isn't plausible for the lesson's scheduled duration.
 */

const LESSON = { id: 'les-1', organizationId: 'org-1', teacherId: 'tea-1', studentId: 'stu-1', enrollmentId: null, duration: 30, enrollment: null };

function makeService(lesson: Record<string, unknown> = LESSON) {
  const db = {
    db: {
      query: {
        lessons: { findFirst: async () => lesson },
        attendance: { findFirst: async () => undefined },
      },
      transaction: async (fn: (tx: unknown) => unknown) => {
        const tx = {
          insert: () => ({ values: () => ({ returning: async () => [{ id: 'att-1' }] }) }),
          update: () => ({ set: () => ({ where: async () => undefined }) }),
        };
        return fn(tx);
      },
    },
  };
  return new AttendanceService(db as never);
}

describe('AttendanceService.markAttendance — actual-duration plausibility', () => {
  it('rejects an actualEndedAt before actualStartedAt', async () => {
    const svc = makeService();
    await expect(svc.markAttendance('org-1', 'les-1', {
      status: 'cancelled_teacher',
      actualStartedAt: '2026-08-01T10:30:00Z',
      actualEndedAt: '2026-08-01T10:00:00Z',
    } as never, null)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an implausibly long actual duration for the scheduled lesson length', async () => {
    const svc = makeService();
    await expect(svc.markAttendance('org-1', 'les-1', {
      status: 'cancelled_teacher',
      actualStartedAt: '2026-08-01T10:00:00Z',
      actualEndedAt: '2026-08-01T15:00:00Z', // 5 hours for a 30-min lesson
    } as never, null)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows a plausible actual duration (a lesson that ran a bit long)', async () => {
    const svc = makeService();
    await expect(svc.markAttendance('org-1', 'les-1', {
      status: 'cancelled_teacher',
      actualStartedAt: '2026-08-01T10:00:00Z',
      actualEndedAt: '2026-08-01T10:35:00Z', // 35 min for a 30-min lesson
    } as never, null)).resolves.toMatchObject({ id: 'att-1' });
  });

  it('allows marking attendance with no actual times at all', async () => {
    const svc = makeService();
    await expect(svc.markAttendance('org-1', 'les-1', {
      status: 'cancelled_teacher',
    } as never, null)).resolves.toMatchObject({ id: 'att-1' });
  });
});
