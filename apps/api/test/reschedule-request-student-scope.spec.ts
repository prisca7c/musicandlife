import { SchedulingService } from '../src/scheduling/scheduling.service';
import { NotFoundException } from '@nestjs/common';

/**
 * createRescheduleRequest scopes family callers to their OWN family's lessons —
 * but a GUARDIAN covers the whole family while a logged-in STUDENT must be
 * scoped to their own lesson, never a sibling's (mirrors the family-portal
 * student/guardian split, #178). This is the same class of gap in a different
 * module.
 */

type Lesson = { id: string; studentId: string; startsAt: Date };
type StudentRow = { familyId: string; studentUserId: string | null };

const FUTURE = () => new Date(Date.now() + 72 * 3600_000); // >24h ahead

function makeService(lesson: Lesson, lessonStudent: StudentRow, callerStudent: StudentRow) {
  const db = {
    db: {
      query: {
        guardians: { findFirst: async () => undefined }, // caller is a student
        students: {
          findFirst: async (arg: { columns?: Record<string, boolean> }) =>
            // The scope block asks for studentUserId; resolveFamilyId does not.
            arg.columns?.studentUserId ? lessonStudent : callerStudent,
        },
      },
      insert: () => ({ values: () => ({ returning: async () => [{ id: 'req-1', status: 'pending' }] }) }),
    },
  };

  const svc = new SchedulingService(db as never, {} as never);
  jest.spyOn(svc, 'getLesson').mockResolvedValue(lesson as never);
  jest.spyOn(svc as never as { getOrgTimezone: (...a: unknown[]) => Promise<string> }, 'getOrgTimezone')
    .mockResolvedValue('Europe/London');
  return svc;
}

const dto = (lessonId: string) => ({
  lessonId,
  proposedStartsAt: '2026-09-01T10:00:00',
}) as never;

describe('SchedulingService.createRescheduleRequest — student sibling scope', () => {
  it('rejects a student rescheduling a sibling\'s lesson', async () => {
    const svc = makeService(
      { id: 'l-sib', studentId: 's-sibling', startsAt: FUTURE() },
      { familyId: 'fam-1', studentUserId: 'sibling-user' }, // lesson belongs to the sibling
      { familyId: 'fam-1', studentUserId: 'me-user' },      // caller is a different student
    );
    await expect(
      svc.createRescheduleRequest('org-1', dto('l-sib'), { role: 'student', userId: 'me-user' } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows a student rescheduling their own lesson', async () => {
    const svc = makeService(
      { id: 'l-mine', studentId: 's-me', startsAt: FUTURE() },
      { familyId: 'fam-1', studentUserId: 'me-user' },
      { familyId: 'fam-1', studentUserId: 'me-user' },
    );
    const req = await svc.createRescheduleRequest('org-1', dto('l-mine'), { role: 'student', userId: 'me-user' } as never);
    expect((req as { id: string }).id).toBe('req-1');
  });

  it('still lets a guardian reschedule any child in the family', async () => {
    const svc = makeService(
      { id: 'l-sib', studentId: 's-sibling', startsAt: FUTURE() },
      { familyId: 'fam-1', studentUserId: 'sibling-user' },
      { familyId: 'fam-1', studentUserId: null },
    );
    const req = await svc.createRescheduleRequest('org-1', dto('l-sib'), { role: 'guardian', userId: 'parent-user' } as never);
    expect((req as { id: string }).id).toBe('req-1');
  });
});
