import { BadRequestException } from '@nestjs/common';
import { SchedulingService } from '../src/scheduling/scheduling.service';

/**
 * A lesson may only be rescheduled while it is live ('scheduled' or 'makeup').
 * A 'completed' or 'cancelled_*' lesson is a settled historical record — moving
 * it re-timetables a teacher and leaves a dead-status lesson at a new time.
 *
 * The family self-service path made this reachable: a family that cancels a
 * FUTURE lesson (cancelled_makeup/cancelled_no_pay, still >24h away) could file
 * a reschedule request against it, and a teacher approving it would move the
 * cancelled lesson into a real slot — a no-charge lesson a teacher then teaches.
 *
 * The guard lives at three points: createRescheduleRequest (reject at the door),
 * decideRescheduleRequest (before the guarded claim, so the request isn't
 * stranded 'approved' with the lesson unmoved — the #190 stuck state), and
 * directReschedule (the authoritative mutation every path routes through).
 */

const FUTURE = () => new Date(Date.now() + 72 * 3600_000); // >24h ahead, so the lead check passes

// ─── directReschedule — the authoritative mutation ────────────────────────────
describe('SchedulingService.directReschedule — only a live lesson moves', () => {
  function make(status: string) {
    const txn = jest.fn();
    const svc = new SchedulingService({ db: { transaction: txn } } as never, null as never);
    Object.assign(svc as object, {
      getLesson: async () => ({ id: 'les-1', teacherId: 'tea-1', duration: 30, status, startsAt: FUTURE() }),
      assertOwnsLesson: async () => undefined,
    });
    return { svc, txn };
  }
  const move = (svc: SchedulingService) =>
    svc.directReschedule('org-1', 'les-1', '2026-09-01T10:00:00');

  it('rejects a cancelled lesson before opening the write transaction', async () => {
    const { svc, txn } = make('cancelled_makeup');
    await expect(move(svc)).rejects.toBeInstanceOf(BadRequestException);
    expect(txn).not.toHaveBeenCalled();
  });

  it('rejects a completed lesson', async () => {
    const { svc, txn } = make('completed');
    await expect(move(svc)).rejects.toBeInstanceOf(BadRequestException);
    expect(txn).not.toHaveBeenCalled();
  });

  it('proceeds for a scheduled lesson (reaches the transaction)', async () => {
    const { svc, txn } = make('scheduled');
    txn.mockResolvedValue({ id: 'les-1' });
    // The real method chains .then(notify) after the transaction; stub notify away.
    Object.assign(svc as object, { notifyRescheduled: async () => undefined });
    await move(svc);
    expect(txn).toHaveBeenCalledTimes(1);
  });
});

// ─── createRescheduleRequest — reject a dead lesson at the door ────────────────
describe('SchedulingService.createRescheduleRequest — only a live lesson', () => {
  function make(status: string) {
    const insert = jest.fn(() => ({ values: () => ({ returning: async () => [{ id: 'req-1' }] }) }));
    const svc = new SchedulingService({ db: { insert } } as never, null as never);
    Object.assign(svc as object, {
      getLesson: async () => ({ id: 'les-1', studentId: 'stu-1', teacherId: 'tea-1', duration: 30, status, startsAt: FUTURE() }),
      getOrgTimezone: async () => 'Europe/London',
    });
    return { svc, insert };
  }
  // Staff actor (receptionist) so the guardian/student ownership block is skipped
  // and we reach the status guard directly.
  const create = (svc: SchedulingService) =>
    (svc as never as { createRescheduleRequest: (o: string, dto: unknown, a: unknown) => Promise<unknown> })
      .createRescheduleRequest('org-1', { lessonId: 'les-1', proposedStartsAt: '2026-09-01T10:00:00' }, { role: 'receptionist', userId: 'rec-1' });

  it('rejects a request against a cancelled lesson and never inserts', async () => {
    const { svc, insert } = make('cancelled_no_pay');
    await expect(create(svc)).rejects.toBeInstanceOf(BadRequestException);
    expect(insert).not.toHaveBeenCalled();
  });

  it('inserts a request for a scheduled lesson', async () => {
    const { svc, insert } = make('scheduled');
    await expect(create(svc)).resolves.toEqual({ id: 'req-1' });
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

// ─── decideRescheduleRequest — pre-check before the claim ──────────────────────
describe('SchedulingService.decideRescheduleRequest — dead lesson caught before claim', () => {
  function make(lessonStatus: string) {
    const claimUpdate = jest.fn(() => ({ set: () => ({ where: () => ({ returning: async () => [{ id: 'req-1' }] }) }) }));
    const db = {
      db: {
        query: {
          rescheduleRequests: {
            findFirst: async () => ({
              id: 'req-1', lessonId: 'les-1', status: 'pending',
              proposedStartsAt: new Date('2026-09-01T10:00:00.000Z'),
              proposedStartsAt2: null, proposedStartsAt3: null,
              lesson: { teacherId: 'tea-1' },
            }),
          },
        },
        update: claimUpdate,
      },
    };
    const directReschedule = jest.fn(async () => ({ id: 'les-1' }));
    const svc = new SchedulingService(db as never, null as never);
    Object.assign(svc as object, {
      getLesson: async () => ({ id: 'les-1', teacherId: 'tea-1', duration: 30, status: lessonStatus, startsAt: FUTURE() }),
      getOrgTimezone: async () => 'Europe/London',
      teacherUnavailableReason: async () => null,
      hasConflict: async () => false,
      directReschedule,
    });
    return { svc, claimUpdate, directReschedule };
  }
  const decide = (svc: SchedulingService) =>
    (svc as never as { decideRescheduleRequest: (...a: unknown[]) => Promise<unknown> })
      .decideRescheduleRequest('org-1', 'req-1', 'approved', 'mgr-1', undefined, undefined, { role: 'manager', userId: 'mgr-1' });

  it('rejects when the lesson was cancelled after the request — stays pending, never moves', async () => {
    const { svc, claimUpdate, directReschedule } = make('cancelled_makeup');
    await expect(decide(svc)).rejects.toBeInstanceOf(BadRequestException);
    expect(claimUpdate).not.toHaveBeenCalled();
    expect(directReschedule).not.toHaveBeenCalled();
  });

  it('approves when the lesson is still scheduled', async () => {
    const { svc, claimUpdate, directReschedule } = make('scheduled');
    await expect(decide(svc)).resolves.toEqual({ id: 'req-1', status: 'approved' });
    expect(claimUpdate).toHaveBeenCalledTimes(1);
    expect(directReschedule).toHaveBeenCalledTimes(1);
  });
});
