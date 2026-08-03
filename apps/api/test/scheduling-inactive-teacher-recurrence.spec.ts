import { SchedulingService } from '../src/scheduling/scheduling.service';

/**
 * When a teacher leaves, the office deactivates them (staffMembers.status =
 * 'inactive') and the roster/calendar drop them immediately. But nothing
 * cascades to their enrolments — those stay 'active' with a weekly scheduleRule.
 * The daily recurrence worker (materializeAllRecurring) keys on the ENROLMENT's
 * status alone, so it used to keep generating a fresh week of lessons under a
 * teacher who had gone, which autoCompleteOverdue then marked present and BILLED
 * the family. The worker must skip enrolments whose teacher is no longer active,
 * while still serving enrolments with an active teacher (or no teacher yet).
 */

type Row = Record<string, unknown>;

function makeService(enrolments: Row[], inactiveTeacherIds: string[]) {
  const db = {
    db: {
      query: {
        enrollments: { findMany: async () => enrolments },
        staffMembers: { findMany: async () => inactiveTeacherIds.map((id) => ({ id })) },
      },
    },
  };
  const svc = new SchedulingService(db as never, null as never);
  const served: string[] = [];
  // Stub the per-enrolment path: we only care WHICH enrolments the worker
  // chooses to materialise, not the lesson maths (covered elsewhere).
  jest
    .spyOn(svc, 'materializeEnrollment')
    .mockImplementation(async (_org: string, id: string) => {
      served.push(id);
      return { created: 1, skippedExisting: 0, skippedConflicts: 0, through: '', weeks: 0 };
    });
  return { svc, served };
}

const RULE = { weekday: 'monday', startTime: '16:00' };

describe('SchedulingService.materializeAllRecurring — inactive teacher', () => {
  it('skips enrolments whose teacher is inactive, keeps active and unassigned ones', async () => {
    const { svc, served } = makeService(
      [
        { id: 'e-active', organizationId: 'org-1', teacherId: 'tea-active', scheduleRule: RULE },
        { id: 'e-inactive', organizationId: 'org-1', teacherId: 'tea-gone', scheduleRule: RULE },
        { id: 'e-unassigned', organizationId: 'org-1', teacherId: null, scheduleRule: RULE },
        { id: 'e-norule', organizationId: 'org-1', teacherId: 'tea-active', scheduleRule: null },
      ],
      ['tea-gone'],
    );

    const res = await svc.materializeAllRecurring('org-1');

    // The departed teacher's enrolment is skipped; the rule-less one is skipped
    // for the usual reason; the active and unassigned enrolments are served.
    expect(served).toEqual(['e-active', 'e-unassigned']);
    expect(res.created).toBe(2);
  });

  it('serves every enrolment when no teacher is inactive', async () => {
    const { svc, served } = makeService(
      [
        { id: 'e1', organizationId: 'org-1', teacherId: 'tea-a', scheduleRule: RULE },
        { id: 'e2', organizationId: 'org-1', teacherId: 'tea-b', scheduleRule: RULE },
      ],
      [],
    );

    await svc.materializeAllRecurring('org-1');
    expect(served).toEqual(['e1', 'e2']);
  });
});
