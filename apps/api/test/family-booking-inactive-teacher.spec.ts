import { BadRequestException } from '@nestjs/common';
import { SchedulingService } from '../src/scheduling/scheduling.service';

/**
 * A family self-booking may only land on a teacher who is still active. When a
 * teacher departs they are deactivated (staffMembers.status='inactive') and the
 * recurrence worker stops generating their lessons — but an enrolment whose
 * teacherId still points at them stays 'active', so the self-book path can reach
 * createFamilyBooking with a stale picker or a crafted request. Booking a fresh
 * lesson onto a departed teacher puts it on their timetable and pays them at
 * payroll for a studio they no longer work for; createFamilyBooking must reject
 * it before any lesson is created, exactly as it guards the enrolment.
 */

function makeService(teacherStatus: 'active' | 'inactive') {
  const createLesson = jest.fn(async () => ({ id: 'les-1' }));
  const db = {
    db: {
      query: {
        enrollments: {
          findFirst: async () => ({ lessonType: 'private', status: 'active' }),
        },
        staffMembers: {
          findFirst: async () => ({ status: teacherStatus }),
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

describe('SchedulingService.createFamilyBooking — teacher must be active', () => {
  it('rejects a deactivated teacher before creating any lesson', async () => {
    const { svc, createLesson } = makeService('inactive');
    await expect(book(svc)).rejects.toBeInstanceOf(BadRequestException);
    expect(createLesson).not.toHaveBeenCalled();
  });

  it('allows an active teacher (books the lesson)', async () => {
    const { svc, createLesson } = makeService('active');
    const res = (await book(svc)) as { lesson: { id: string } };
    expect(res.lesson.id).toBe('les-1');
    expect(createLesson).toHaveBeenCalledTimes(1);
  });
});
