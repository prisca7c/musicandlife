import { SchedulingService } from '../src/scheduling/scheduling.service';

/**
 * checkConflicts already guards a student against overlapping lessons with two
 * different teachers, but that check ran under an advisory lock keyed ONLY on
 * the teacher. Two concurrent bookings for the same student with two different
 * teachers took two different (non-conflicting) teacher locks and could both
 * pass the student-clash check before either committed — the student ends up
 * double-booked. lockResources must also take a lock keyed on the student.
 */

const lockResources = (s: SchedulingService, tx: unknown, orgId: string, teacherId?: string | null, studentId?: string | null) =>
  (s as unknown as {
    lockResources: (tx: unknown, orgId: string, teacherId?: string | null, studentId?: string | null) => Promise<void>;
  }).lockResources(tx, orgId, teacherId, studentId);

describe('SchedulingService.lockResources — locks both teacher and student', () => {
  it('takes an advisory lock for both the teacher and the student', async () => {
    const calls: string[] = [];
    const tx = { execute: async (query: { queryChunks?: unknown[] } | unknown) => { calls.push(JSON.stringify(query)); } };
    const s = new SchedulingService(null as never, null as never);
    await lockResources(s, tx, 'org-1', 'tea-1', 'stu-1');
    expect(calls).toHaveLength(2);
  });

  it('takes only one lock when only a teacher is given', async () => {
    const calls: string[] = [];
    const tx = { execute: async () => { calls.push('x'); } };
    const s = new SchedulingService(null as never, null as never);
    await lockResources(s, tx, 'org-1', 'tea-1', undefined);
    expect(calls).toHaveLength(1);
  });

  it('takes no lock when neither is given', async () => {
    const calls: string[] = [];
    const tx = { execute: async () => { calls.push('x'); } };
    const s = new SchedulingService(null as never, null as never);
    await lockResources(s, tx, 'org-1', undefined, undefined);
    expect(calls).toHaveLength(0);
  });
});
