import { NotFoundException, BadRequestException } from '@nestjs/common';
import { FamilyPortalController } from '../src/family-portal/family-portal.controller';

/**
 * The family booking picker's `availability` endpoint takes a raw teacherId and
 * returns that teacher's open slots for a week. The returned slots reveal, by
 * omission, when the teacher is already booked or blocked — so an unscoped
 * teacherId let ANY signed-in guardian/student read ANY in-org teacher's
 * free/busy schedule. The endpoint must only expose a teacher the caller's
 * family actually has (via an enrolment or an explicit teacher assignment),
 * matching the family-scoping already enforced by `teachers` and
 * `teacher-availability`.
 */

type Row = Record<string, unknown>;

// Minimal mock of DbService.db.query covering only the tables getAvailability
// touches on its way to the guard: family resolution → family students →
// familyTeacherIds (enrolments + teacher assignments).
function makeDb(opts: {
  guardianFamilyId?: string | null;
  students?: Row[];
  enrollmentTeacherIds?: (string | null)[];
  assignmentStaffIds?: string[];
}) {
  const {
    guardianFamilyId = 'fam-1',
    students = [{ id: 'stu-1' }],
    enrollmentTeacherIds = ['teacher-mine'],
    assignmentStaffIds = [],
  } = opts;
  return {
    db: {
      query: {
        guardians: { findFirst: async () => (guardianFamilyId ? { familyId: guardianFamilyId } : null) },
        students: { findFirst: async () => null },
        families: { findFirst: async () => ({ id: guardianFamilyId, students }) },
        enrollments: { findMany: async () => enrollmentTeacherIds.map(teacherId => ({ teacherId })) },
        teacherAssignments: { findMany: async () => assignmentStaffIds.map(staffId => ({ staffId })) },
      },
    },
  };
}

function makeController(db: unknown, getAvailableSlotsWeek: jest.Mock) {
  const scheduling = { getAvailableSlotsWeek } as unknown;
  // Only db + scheduling are exercised by getAvailability; the rest are unused.
  return new FamilyPortalController(
    db as never, null as never, null as never, null as never, null as never, scheduling as never, null as never,
  );
}

const user = { userId: 'u-1', orgId: 'org-1' } as never;

describe('FamilyPortalController.getAvailability — teacher scoping', () => {
  it('returns slots for a teacher the family actually has', async () => {
    const slots = jest.fn().mockResolvedValue([{ startsAt: '2026-07-29T14:00:00Z' }]);
    const db = makeDb({ enrollmentTeacherIds: ['teacher-mine'] });
    const controller = makeController(db, slots);

    const result = await controller.getAvailability(user, 'teacher-mine', '2026-07-27', '60');

    expect(result).toEqual([{ startsAt: '2026-07-29T14:00:00Z' }]);
    expect(slots).toHaveBeenCalledWith('org-1', 'teacher-mine', '2026-07-27', 60, { futureOnly: true });
  });

  it('rejects a teacher the family does not have — no schedule leak', async () => {
    const slots = jest.fn();
    const db = makeDb({ enrollmentTeacherIds: ['teacher-mine'] });
    const controller = makeController(db, slots);

    await expect(controller.getAvailability(user, 'teacher-someone-else', '2026-07-27', '60')).rejects.toThrow(
      NotFoundException,
    );
    expect(slots).not.toHaveBeenCalled();
  });

  it('accepts a teacher linked only by explicit assignment (no enrolment)', async () => {
    const slots = jest.fn().mockResolvedValue([]);
    const db = makeDb({ enrollmentTeacherIds: [], assignmentStaffIds: ['teacher-assigned'] });
    const controller = makeController(db, slots);

    await controller.getAvailability(user, 'teacher-assigned', '2026-07-27', '60');
    expect(slots).toHaveBeenCalled();
  });

  it('still requires teacherId and weekStart before doing any work', async () => {
    const slots = jest.fn();
    const db = makeDb({});
    const controller = makeController(db, slots);

    await expect(controller.getAvailability(user, '', '2026-07-27', '60')).rejects.toThrow(BadRequestException);
    expect(slots).not.toHaveBeenCalled();
  });
});
