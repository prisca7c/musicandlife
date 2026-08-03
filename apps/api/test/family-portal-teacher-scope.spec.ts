import { FamilyPortalController } from '../src/family-portal/family-portal.controller';
import type { RequestUser } from '@music-life/types';

/**
 * The booking/availability read surfaces (getTeachers, teacher-availability,
 * availability) derive "your teachers" from the family's students. A guardian
 * covers the whole family, but a logged-in STUDENT must see only their own
 * teachers — never a sibling's teacher or that teacher's free/busy schedule.
 * These endpoints kept using the whole-family student set for a student caller,
 * the last sibling-scope gap left after #178/#180. This guards that each feeds
 * familyTeacherIds only the caller-scoped student ids.
 */

const FAMILY_ID = 'fam-1';

function makeController(role: 'student' | 'guardian') {
  const db = {
    db: {
      query: {
        // resolveFamilyId: a guardian resolves via guardians; a student via students.
        guardians: { findFirst: async () => (role === 'guardian' ? { familyId: FAMILY_ID } : undefined) },
        students: { findFirst: async () => ({ id: 's-me', familyId: FAMILY_ID }) },
        families: {
          findFirst: async () => ({ id: FAMILY_ID, name: 'Fam', students: [{ id: 's-me' }, { id: 's-sibling' }] }),
        },
      },
    },
  };
  const ctrl = new FamilyPortalController(
    db as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
  );
  // Capture what student-id set the teacher derivation is fed, and short-circuit.
  const spy = jest
    .spyOn(ctrl as never as { familyTeacherIds: (o: string, ids: string[]) => Promise<string[]> }, 'familyTeacherIds')
    .mockResolvedValue([]);
  return { ctrl, spy };
}

const user = (role: 'student' | 'guardian'): RequestUser =>
  ({ userId: 'u-1', orgId: 'org-1', role } as unknown as RequestUser);

describe('FamilyPortalController — teacher scoping for a student caller', () => {
  it('getTeachers: a student is scoped to their own teachers, not a sibling\'s', async () => {
    const { ctrl, spy } = makeController('student');
    await ctrl.getTeachers(user('student'));
    expect(spy).toHaveBeenCalledWith('org-1', ['s-me']);
  });

  it('getTeachers: a guardian still covers the whole family', async () => {
    const { ctrl, spy } = makeController('guardian');
    await ctrl.getTeachers(user('guardian'));
    expect(spy).toHaveBeenCalledWith('org-1', ['s-me', 's-sibling']);
  });

  it('teacherAvailability: a student is scoped to their own teachers', async () => {
    const { ctrl, spy } = makeController('student');
    await ctrl.teacherAvailability(user('student'));
    expect(spy).toHaveBeenCalledWith('org-1', ['s-me']);
  });

  it('availability: a student picking a sibling\'s teacher is rejected (scoped set is their own)', async () => {
    const { ctrl, spy } = makeController('student');
    // familyTeacherIds returns [] (mock), so any teacherId fails the includes()
    // check → NotFound; the point is the scoped student set fed to it.
    await expect(
      ctrl.getAvailability(user('student'), 'sibling-teacher', '2026-09-07', '60'),
    ).rejects.toThrow();
    expect(spy).toHaveBeenCalledWith('org-1', ['s-me']);
  });
});
