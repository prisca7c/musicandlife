import { ForbiddenException } from '@nestjs/common';
import { SchedulingService } from '../src/scheduling/scheduling.service';

/**
 * Bulk-delete every lesson on one day, for a closure. Admin only,
 * hard-deletes (not cancel — no notification email goes out, since the
 * business already tells families directly). Works for a future date too:
 * it records a closureDates row so the nightly recurrence worker's
 * occurrence loop (see scheduling-materialize-skips-closed-date.spec.ts)
 * knows not to regenerate a weekly series' slot there, instead of the
 * deleted lessons silently reappearing before the closure day arrives.
 */

const ADMIN = { role: 'admin', userId: 'admin-1' } as const;
const TEACHER = { role: 'teacher', userId: 'tea-1' } as const;

function make(lessons: { id: string; startsAt: Date; attendance: unknown; student: unknown }[], billedIds: Set<string> = new Set()) {
  const deleteCalls: string[] = [];
  const insertCalls: { table: string; values: unknown }[] = [];
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
      insert: (table: unknown) => ({
        values: (values: unknown) => {
          insertCalls.push({ table: String(table), values });
          return { onConflictDoNothing: async () => undefined };
        },
      }),
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
  return { svc, txn, deleteCalls, insertCalls };
}

describe('SchedulingService.deleteLessonsForDay', () => {
  it('refuses a non-admin actor', async () => {
    const { svc } = make([]);
    await expect(svc.deleteLessonsForDay('org-1', '2020-01-01', TEACHER)).rejects.toBeInstanceOf(ForbiddenException);
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
        insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }),
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

  it('records a closure for the date, including for a future date, so the recurrence worker skips it', async () => {
    const farFuture = new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0]!;
    const { svc, insertCalls } = make([]);

    const result = await svc.deleteLessonsForDay('org-1', farFuture, ADMIN);

    expect(result).toEqual({ deleted: 0, skipped: [] });
    expect(insertCalls).toEqual([{ table: expect.any(String), values: { organizationId: 'org-1', date: farFuture, createdBy: 'admin-1' } }]);
  });
});
