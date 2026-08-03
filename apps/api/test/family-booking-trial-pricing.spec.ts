import { FamilyPortalController } from '../src/family-portal/family-portal.controller';

/**
 * Trial pricing must be decided by the enrolment's state, never the client. The
 * family portal used to pass dto.isTrialLesson straight into createFamilyBooking,
 * so a crafted request could flag ANY lesson as a trial and be billed the flat
 * (often free/discounted) trialRate from effectiveLessonAmount instead of the
 * real rate. A self-booked lesson is a trial only while the enrolment is a trial.
 */

type Row = Record<string, unknown>;

function makeController(enrollmentStatus: 'trial' | 'active') {
  const captured: { isTrialLesson?: boolean } = {};

  const db = {
    db: {
      query: {
        guardians: { findFirst: async () => ({ familyId: 'fam-1' }) },
        families: { findFirst: async () => ({ id: 'fam-1', students: [{ id: 'stu-1' }] }) },
        enrollments: {
          findFirst: async () => ({
            id: 'enr-1', studentId: 'stu-1', teacherId: 'tea-1',
            status: enrollmentStatus, termId: null, instrument: 'Piano',
          }),
        },
        staffMembers: { findFirst: async () => ({ id: 'tea-1', organizationId: 'org-1', user: { email: 't@x.co' } }) },
        students: { findFirst: async () => ({ id: 'stu-1', family: { email: 'f@x.co', name: 'Fam' } }) },
      },
    },
  };

  const scheduling = {
    createFamilyBooking: async (_org: string, bookingDto: Row) => {
      captured.isTrialLesson = bookingDto.isTrialLesson as boolean;
      return { lesson: { id: 'les-1' }, request: { id: 'req-1' } };
    },
  };

  const ctrl = new FamilyPortalController(
    db as never, {} as never, {} as never, {} as never, {} as never, scheduling as never, {} as never,
  );
  // Confirmation emails are irrelevant to pricing — stub them out.
  jest.spyOn(ctrl as never as { sendBookingConfirmations: () => Promise<void> }, 'sendBookingConfirmations')
    .mockResolvedValue(undefined);

  return { ctrl, captured };
}

const user = { userId: 'u-1', orgId: 'org-1', role: 'student' } as never;
const body = (isTrialLesson: boolean) => ({
  teacherId: 'tea-1', studentId: 'stu-1', enrollmentId: 'enr-1',
  startsAt: '2026-09-01T10:00:00.000Z', duration: 30, isTrialLesson,
}) as never;

describe('FamilyPortalController.bookLesson — trial pricing is server-derived', () => {
  it('ignores a client isTrialLesson=true when the enrolment is active (bills the real rate)', async () => {
    const { ctrl, captured } = makeController('active');
    await ctrl.bookLesson(user, body(true));
    expect(captured.isTrialLesson).toBe(false);
  });

  it('prices as a trial when the enrolment itself is a trial, even if the client says false', async () => {
    const { ctrl, captured } = makeController('trial');
    await ctrl.bookLesson(user, body(false));
    expect(captured.isTrialLesson).toBe(true);
  });
});
