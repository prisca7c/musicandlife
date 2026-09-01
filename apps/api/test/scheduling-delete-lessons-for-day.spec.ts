import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SchedulingService } from '../src/scheduling/scheduling.service';

/**
 * Bulk-delete every lesson on one day, for an unexpected closure. Admin only,
 * hard-deletes (not cancel — no notification email goes out, since the
 * business already tells families directly), and refuses a future date
 * because the nightly recurrence worker's dedup only checks whether a
 * `lessons` row currently occupies a slot in its rolling window — a lesson
 * deleted ahead of its date would just be silently recreated before the
 * closure day arrives.
 */

const ADMIN = { role: 'admin', userId: 'admin-1' } as const;
const TEACHER = { role: 'teacher', userId: 'tea-1' } as const;

function make(lessons: { id: string; startsAt: Date; attendance: unknown; student: unknown }[], billedIds: Set<string> = new Set()) {
  const deleteCalls: string[] = [];
  const txn = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    delete: () => ({ where: async () => { deleteCalls.push('deleted'); } }),
  }));
  // findFirst is called once per candidate lesson, in the same order
  // `lessons` was iterated — track that order explicitly rather than trying
  // to parse the drizzle `where` builder's internals.
  let cursor = 0;
  const db = {
    db: {
      transaction: txn,
      query: {
        lessons: { findMany: async () => lessons },
        invoiceLineItems: { findFirst: async () => {
          const id = lessons[cursor]?.id; cursor++;
          return id && billedIds.has(id) ? { id: 'li-1' } : undefined;
        } },
      },
    },
  };
  const svc = new SchedulingService(db as never, null as never, { reverseAndClearAttendance: jest.fn() } as never);
  Object.assign(svc as object, { getOrgTimezone: async () => 'Europe/London' });
  return { svc, txn, deleteCalls };
}

describe('SchedulingService.deleteLessonsForDay', () => {
  it('refuses a non-admin actor', async () => {
    const { svc } = make([]);
    await expect(svc.deleteLessonsForDay('org-1', '2020-01-01', TEACHER)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a future date without querying any lessons', async () => {
    const { svc, txn } = make([{ id: 'les-1', startsAt: new Date(), attendance: null, student: null }]);
    const farFuture = new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0]!;
    await expect(svc.deleteLessonsForDay('org-1', farFuture, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
    expect(txn).not.toHaveBeenCalled();
  });

  it('deletes clean lessons and skips an already-billed one, with no notification path involved', async () => {
    const lessons = [
      { id: 'les-clean', startsAt: new Date('2020-01-01T10:00:00Z'), attendance: null, student: { firstName: 'Ada', lastName: 'Lovelace' } },
      { id: 'les-billed', startsAt: new Date('2020-01-01T11:00:00Z'), attendance: null, student: { firstName: 'Alan', lastName: 'Turing' } },
    ];
    const { svc, txn, deleteCalls } = make(lessons, new Set(['les-billed']));

    const result = await svc.deleteLessonsForDay('org-1', '2020-01-01', ADMIN);

    expect(result.deleted).toBe(1);
    expect(result.skipped).toEqual([{ lessonId: 'les-billed', student: 'Alan Turing', reason: 'already on an invoice' }]);
    expect(txn).toHaveBeenCalledTimes(1); // only for the clean lesson
    // detachLessonReferences deletes any stray rescheduleRequests row, then
    // the lesson itself — two `delete()` calls within that one transaction.
    expect(deleteCalls).toEqual(['deleted', 'deleted']);
  });

  it('reverses attendance before deleting a lesson that has it recorded', async () => {
    const reverseAndClearAttendance = jest.fn();
    const lessons = [{ id: 'les-attended', startsAt: new Date('2020-01-01T10:00:00Z'), attendance: { id: 'att-1' }, student: null }];
    const db = {
      db: {
        transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({
          update: () => ({ set: () => ({ where: async () => undefined }) }),
          delete: () => ({ where: async () => undefined }),
        })),
        query: {
          lessons: { findMany: async () => lessons },
          invoiceLineItems: { findFirst: async () => undefined },
        },
      },
    };
    const svc = new SchedulingService(db as never, null as never, { reverseAndClearAttendance } as never);
    Object.assign(svc as object, { getOrgTimezone: async () => 'Europe/London' });

    const result = await svc.deleteLessonsForDay('org-1', '2020-01-01', ADMIN);

    expect(result.deleted).toBe(1);
    expect(reverseAndClearAttendance).toHaveBeenCalledWith('org-1', 'les-attended', expect.anything());
  });
});
