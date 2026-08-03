import { ReminderWorker } from '../src/notifications/reminder.worker';

/**
 * The booking-review reminder emails the TEACHER that a family self-booked a
 * lesson, embedding the student's name in the body. That name is family/guardian
 * -supplied (public self-booking / registration) and the notification template
 * renders `body` as raw HTML, so an unescaped name is a stored HTML-injection
 * vector into a staff inbox (phishing link / tracking pixel). This guards that
 * the name is HTML-escaped before it reaches the teacher.
 */

function makeWorker(studentFirst: string, studentLast: string) {
  const trigger = jest.fn().mockResolvedValue(undefined);
  const req = {
    organizationId: 'org-1',
    proposedStartsAt: new Date('2026-09-07T14:00:00Z'),
    teacher: { firstName: 'T', user: { email: 'teacher@example.com' } },
    student: { firstName: studentFirst, lastName: studentLast },
  };
  const db = {
    db: {
      query: {
        lessonRequests: { findMany: async () => [req] },
        organizations: { findFirst: async () => ({ timezone: 'Europe/London' }) },
      },
    },
  };
  const worker = new ReminderWorker(db as never, { trigger } as never);
  return { worker, trigger };
}

describe('ReminderWorker.scanBookingReviews — student name escaping', () => {
  it('HTML-escapes a guardian-supplied student name in the teacher email body', async () => {
    const { worker, trigger } = makeWorker('<img src=x onerror=alert(1)>', 'Smith');
    await (worker as never as { scanBookingReviews: () => Promise<void> }).scanBookingReviews();

    expect(trigger).toHaveBeenCalledTimes(1);
    const [event, ctx] = trigger.mock.calls[0];
    expect(event).toBe('booking.review_reminder');
    expect(ctx.body).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(ctx.body).not.toContain('<img');
  });

  it('leaves an ordinary name intact', async () => {
    const { worker, trigger } = makeWorker('Ada', 'Byron');
    await (worker as never as { scanBookingReviews: () => Promise<void> }).scanBookingReviews();

    const [, ctx] = trigger.mock.calls[0];
    expect(ctx.body).toContain('Ada Byron');
  });
});
