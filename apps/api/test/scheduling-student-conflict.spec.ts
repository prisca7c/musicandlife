import { BadRequestException } from '@nestjs/common';
import { SchedulingService } from '../src/scheduling/scheduling.service';

/**
 * A lesson can double-book two resources, and the conflict check must guard
 * both. The teacher side was always checked; the STUDENT side was not — so a
 * child with two teachers (or any staff/portal booking that picked a second
 * teacher) could be booked into two overlapping lessons at once, with nothing
 * to stop it and the family billed for both.
 *
 * checkConflicts is private but is the single gate every creation/reschedule
 * path funnels through, so we exercise it directly with a stubbed executor.
 */

type Row = Record<string, unknown>;

const svc = () => new SchedulingService(null as never, null as never);
const check = (s: SchedulingService, exec: unknown, teacherId?: string, studentId?: string, excludeLessonId?: string) =>
  (s as unknown as {
    checkConflicts: (
      db: unknown, orgId: string, startsAt: string, duration: number,
      teacherId?: string, excludeLessonId?: string, studentId?: string,
    ) => Promise<void>;
  }).checkConflicts(exec, 'org-1', BOOK_START, 60, teacherId, excludeLessonId, studentId);

// Booking a 10:00–11:00 slot.
const BOOK_START = '2026-08-01T10:00:00.000Z';
// An existing lesson at 10:30–11:30 overlaps it; at 11:00–12:00 it does not.
const existing = (over: Row = {}): Row => ({
  id: 'les-existing', startsAt: new Date('2026-08-01T10:30:00.000Z'),
  duration: 60, teacherId: 'tea-A', studentId: 'stu-1', ...over,
});
const execWith = (rows: Row[]) => ({ query: { lessons: { findMany: async () => rows } } });

describe('SchedulingService.checkConflicts — student double-booking', () => {
  it('rejects the same student at an overlapping time even with a different teacher', async () => {
    const s = svc();
    // Booking stu-1 with tea-B; stu-1 already has an overlapping lesson with tea-A.
    await expect(
      check(s, execWith([existing({ teacherId: 'tea-A', studentId: 'stu-1' })]), 'tea-B', 'stu-1'),
    ).rejects.toThrow('Student already has a lesson at this time');
  });

  it('still reports a teacher clash (and prefers that message) when the teacher overlaps', async () => {
    const s = svc();
    await expect(
      check(s, execWith([existing({ teacherId: 'tea-A', studentId: 'stu-9' })]), 'tea-A', 'stu-1'),
    ).rejects.toThrow('Teacher already has a lesson at this time');
  });

  it('allows a different student with a different teacher at the same time', async () => {
    const s = svc();
    await expect(
      check(s, execWith([existing({ teacherId: 'tea-A', studentId: 'stu-9' })]), 'tea-B', 'stu-1'),
    ).resolves.toBeUndefined();
  });

  it('allows the same student back-to-back (no time overlap)', async () => {
    const s = svc();
    await expect(
      check(s, execWith([existing({ startsAt: new Date('2026-08-01T11:00:00.000Z'), teacherId: 'tea-B', studentId: 'stu-1' })]), 'tea-B', 'stu-1'),
    ).resolves.toBeUndefined();
  });

  it('excludes the lesson being rescheduled so it does not clash with itself', async () => {
    const s = svc();
    await expect(
      check(s, execWith([existing({ id: 'les-self', teacherId: 'tea-B', studentId: 'stu-1' })]), 'tea-B', 'stu-1', 'les-self'),
    ).resolves.toBeUndefined();
  });

  it('throws BadRequestException specifically', async () => {
    const s = svc();
    await expect(
      check(s, execWith([existing({ teacherId: 'tea-B', studentId: 'stu-1' })]), 'tea-B', 'stu-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
