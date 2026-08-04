import { BadRequestException } from '@nestjs/common';
import { SchedulingService } from '../src/scheduling/scheduling.service';

/**
 * A family self-booking may only target a LIVE enrolment. Withdrawing an
 * enrolment deliberately ends its series (tears down the recurrence rule and
 * cancels its future lessons); a paused one is temporarily halted. Booking
 * against either — through a stale picker that still lists it, or a crafted
 * request — would create a fresh lesson, re-timetable the teacher and re-bill
 * the family for an instrument they no longer take. createFamilyBooking must
 * reject it before any lesson is created, exactly as it guards group enrolments.
 */

function makeService(status: 'active' | 'trial' | 'paused' | 'withdrawn') {
  const createLesson = jest.fn(async () => ({ id: 'les-1' }));
  const db = {
    db: {
      query: {
        enrollments: {
          findFirst: async () => ({ lessonType: 'private', status }),
        },
        staffMembers: {
          findFirst: async () => ({ status: 'active' }),
        },
      },
      insert: () => ({ values: () => ({ returning: async () => [{ id: 'req-1' }] }) }),
    },
  };
  const svc = new SchedulingService(db as never, null as never);
  Object.assign(svc as object, {
    getOrgTimezone: async () => 'Europe/London',
    createLesson,
  });
  return { svc, createLesson };
}

// A time comfortably past the family-booking lead window.
const futureIso = () => new Date(Date.now() + 30 * 86400000).toISOString();

const book = (svc: SchedulingService) =>
  (svc as never as {
    createFamilyBooking: (o: string, dto: Record<string, unknown>, by: string) => Promise<unknown>;
  }).createFamilyBooking('org-1', {
    studentId: 'stu-1', teacherId: 'tea-1', enrollmentId: 'enr-1',
    startsAt: futureIso(), duration: 30,
  }, 'user-1');

describe('SchedulingService.createFamilyBooking — enrolment must be live', () => {
  it('rejects a withdrawn enrolment before creating any lesson', async () => {
    const { svc, createLesson } = makeService('withdrawn');
    await expect(book(svc)).rejects.toBeInstanceOf(BadRequestException);
    expect(createLesson).not.toHaveBeenCalled();
  });

  it('rejects a paused enrolment before creating any lesson', async () => {
    const { svc, createLesson } = makeService('paused');
    await expect(book(svc)).rejects.toBeInstanceOf(BadRequestException);
    expect(createLesson).not.toHaveBeenCalled();
  });

  it('allows an active enrolment (books the lesson)', async () => {
    const { svc, createLesson } = makeService('active');
    const res = (await book(svc)) as { lesson: { id: string } };
    expect(res.lesson.id).toBe('les-1');
    expect(createLesson).toHaveBeenCalledTimes(1);
  });

  it('allows a trial enrolment (a trial is still bookable)', async () => {
    const { svc, createLesson } = makeService('trial');
    await expect(book(svc)).resolves.toBeTruthy();
    expect(createLesson).toHaveBeenCalledTimes(1);
  });
});
