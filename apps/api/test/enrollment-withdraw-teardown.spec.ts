import { EnrollmentsService } from '../src/enrollments/enrollments.service';
import { enrollments, lessons } from '@music-life/db';

/**
 * Withdrawing an enrolment ends its series. The generic PATCH /enrollments/:id
 * only flipped the status, leaving the recurrence rule and every already-
 * generated future lesson on the diary — staff had to remember to also hit
 * "Stop weekly". A withdraw must now clear the rule and cancel future lessons
 * itself, exactly like stopRecurring (same class as the student-withdraw fix).
 */

type Existing = { id: string; studentId: string; status: string; instrument: string; lessonType: 'private' | 'group'; teacherId: string | null };

function makeService(existing: Existing, futureLessonIds: string[] = ['l-1', 'l-2']) {
  const captured = { enrollmentSet: undefined as Record<string, unknown> | undefined, lessonsTornDown: false };

  const db = {
    db: {
      query: {
        enrollments: { findFirst: async () => existing, findMany: async () => [] },
      },
      update: (table: unknown) => ({
        set: (payload: Record<string, unknown>) => ({
          where: () => ({
            returning: async () => {
              if (table === lessons) {
                captured.lessonsTornDown = true;
                return futureLessonIds.map((id) => ({ id }));
              }
              if (table === enrollments) captured.enrollmentSet = payload;
              return [{ ...existing, ...payload }];
            },
          }),
        }),
      }),
    },
  };

  const svc = new EnrollmentsService(db as never);
  return { svc, captured };
}

const active = (): Existing => ({
  id: 'e-1', studentId: 's-1', status: 'active', instrument: 'Piano', lessonType: 'private', teacherId: null,
});

describe('EnrollmentsService.update — withdraw tears down the series', () => {
  it('withdrawing clears the recurrence rule and cancels future lessons', async () => {
    const { svc, captured } = makeService(active());
    await svc.update('org-1', 'e-1', { status: 'withdrawn' } as never);
    expect(captured.enrollmentSet?.status).toBe('withdrawn');
    expect(captured.enrollmentSet?.scheduleRule).toBeNull();
    expect(captured.lessonsTornDown).toBe(true);
  });

  it('a non-withdraw update leaves the series alone', async () => {
    const { svc, captured } = makeService(active());
    await svc.update('org-1', 'e-1', { status: 'paused' } as never);
    expect(captured.enrollmentSet?.status).toBe('paused');
    expect('scheduleRule' in (captured.enrollmentSet ?? {})).toBe(false);
    expect(captured.lessonsTornDown).toBe(false);
  });

  it('re-withdrawing an already-withdrawn enrolment does not re-run the teardown', async () => {
    const already: Existing = { ...active(), status: 'withdrawn' };
    const { svc, captured } = makeService(already);
    await svc.update('org-1', 'e-1', { status: 'withdrawn' } as never);
    expect(captured.lessonsTornDown).toBe(false);
  });
});
