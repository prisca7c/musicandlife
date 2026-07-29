import { BadRequestException } from '@nestjs/common';
import { FamilyPortalController } from '../src/family-portal/family-portal.controller';

/**
 * The two "cancellation day" lifecycle scenarios, as the family portal enforces
 * them — the money outcome depends entirely on how much notice was given:
 *
 *   Scenario B — cancel with >=24h notice: the family CHOOSES the outcome
 *     (absent_makeup = keep a make-up credit, or absent_no_pay = no charge/no credit).
 *   Scenario C — cancel with <24h notice: no choice; auto absent_no_makeup, so the
 *     teacher is still paid and the student forfeits (this is the "cancel one hour
 *     before the lesson" case).
 *
 * We assert the endpoint hands attendance.markAttendance the right status — that
 * status is what downstream mints/consumes the credit and pays (or doesn't pay)
 * the teacher, so it's the single point where the money outcome is decided.
 */

type Row = Record<string, unknown>;

function makeDb(lesson: Row | null, students: Row[] = [{ id: 'stu-1' }]) {
  return {
    db: {
      query: {
        guardians: { findFirst: async () => ({ familyId: 'fam-1' }) },
        students: { findFirst: async () => null },
        families: { findFirst: async () => ({ id: 'fam-1', students }) },
        lessons: { findFirst: async () => lesson },
      },
    },
  };
}

function makeController(db: unknown, markAttendance: jest.Mock) {
  const attendance = { markAttendance } as unknown;
  return new FamilyPortalController(
    db as never, null as never, attendance as never, null as never, null as never, null as never, null as never,
  );
}

const user = { userId: 'u-1', orgId: 'org-1' } as never;
const lessonAt = (hoursFromNow: number): Row => ({
  id: 'les-1', organizationId: 'org-1', studentId: 'stu-1', status: 'scheduled',
  startsAt: new Date(Date.now() + hoursFromNow * 3600000),
});

describe('FamilyPortalController.cancelLesson — cancellation-day scenarios', () => {
  it('Scenario B (>=24h, choose make-up) → attendance absent_makeup', async () => {
    const mark = jest.fn().mockResolvedValue({});
    const controller = makeController(makeDb(lessonAt(48)), mark);

    const res = await controller.cancelLesson(user, 'les-1', { choice: 'absent_makeup' } as never);

    expect(res.status).toBe('absent_makeup');
    expect(mark).toHaveBeenCalledWith('org-1', 'les-1', { status: 'absent_makeup' }, 'u-1');
  });

  it('Scenario B (>=24h, choose no-pay) → attendance absent_no_pay (no charge, no credit)', async () => {
    const mark = jest.fn().mockResolvedValue({});
    const controller = makeController(makeDb(lessonAt(48)), mark);

    const res = await controller.cancelLesson(user, 'les-1', { choice: 'absent_no_pay' } as never);

    expect(res.status).toBe('absent_no_pay');
    expect(mark).toHaveBeenCalledWith('org-1', 'les-1', { status: 'absent_no_pay' }, 'u-1');
  });

  it('Scenario C (<24h) → forces absent_no_makeup, ignoring the choice (teacher paid, student forfeits)', async () => {
    const mark = jest.fn().mockResolvedValue({});
    const controller = makeController(makeDb(lessonAt(1)), mark);

    // Family asks for a make-up, but <24h notice overrides it.
    const res = await controller.cancelLesson(user, 'les-1', { choice: 'absent_makeup' } as never);

    expect(res.status).toBe('absent_no_makeup');
    expect(mark).toHaveBeenCalledWith('org-1', 'les-1', { status: 'absent_no_makeup' }, 'u-1');
  });

  it("rejects cancelling another family's lesson", async () => {
    const mark = jest.fn();
    const controller = makeController(makeDb(lessonAt(48), [{ id: 'other-kid' }]), mark);

    await expect(controller.cancelLesson(user, 'les-1', { choice: 'absent_no_pay' } as never))
      .rejects.toThrow(BadRequestException);
    expect(mark).not.toHaveBeenCalled();
  });

  it('rejects cancelling a lesson that is not scheduled', async () => {
    const mark = jest.fn();
    const controller = makeController(makeDb({ ...lessonAt(48), status: 'completed' }), mark);

    await expect(controller.cancelLesson(user, 'les-1', { choice: 'absent_makeup' } as never))
      .rejects.toThrow(BadRequestException);
    expect(mark).not.toHaveBeenCalled();
  });
});
