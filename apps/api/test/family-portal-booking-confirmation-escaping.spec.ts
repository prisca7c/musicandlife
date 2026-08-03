import { FamilyPortalController } from '../src/family-portal/family-portal.controller';

/**
 * The booking-confirmation email is sent as raw HTML to the teacher AND every
 * org admin whenever a family self-books a lesson. It embeds the student name
 * and instrument, both family/guardian-supplied. An unescaped name is therefore
 * a stored HTML-injection vector into staff and admin inboxes (phishing link /
 * tracking pixel). This guards that those values are HTML-escaped in the body.
 */

function makeController(send: jest.Mock) {
  const db = {
    db: {
      query: {
        organizations: { findFirst: async () => ({ timezone: 'Europe/London' }) },
        memberships: { findMany: async () => [] }, // no admins needed for the assertion
      },
    },
  };
  const ctrl = new FamilyPortalController(
    db as never, { send } as never, {} as never, {} as never, {} as never, {} as never, {} as never,
  );
  return ctrl;
}

const invoke = (ctrl: FamilyPortalController, args: unknown[]) =>
  (ctrl as never as { sendBookingConfirmations: (...a: unknown[]) => Promise<void> })
    .sendBookingConfirmations(...args);

describe('FamilyPortalController.sendBookingConfirmations — HTML escaping', () => {
  const lesson = { id: 'l-1', startsAt: new Date('2026-09-07T14:00:00Z'), duration: 60 };
  const teacher = { firstName: 'Ada', lastName: 'Byron', user: { email: 'teacher@example.com' } };

  it('escapes a guardian-supplied student name in the email body', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const ctrl = makeController(send);
    const student = {
      firstName: '<img src=x onerror=alert(1)>',
      lastName: 'Smith',
      family: { email: 'family@example.com', name: 'Smith' },
    };

    await invoke(ctrl, ['org-1', lesson, teacher, student, 'piano', false]);

    expect(send).toHaveBeenCalledTimes(1);
    const { html } = send.mock.calls[0][0];
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');
  });

  it('escapes a malicious instrument value in the email body', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const ctrl = makeController(send);
    const student = { firstName: 'Bob', lastName: 'Jones', family: { email: 'f@example.com', name: 'Jones' } };

    await invoke(ctrl, ['org-1', lesson, teacher, student, '<script>x</script>', false]);

    const { html } = send.mock.calls[0][0];
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('leaves an ordinary name intact', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const ctrl = makeController(send);
    const student = { firstName: 'Clara', lastName: 'Schumann', family: { email: 'f@example.com', name: 'Schumann' } };

    await invoke(ctrl, ['org-1', lesson, teacher, student, 'cello', false]);

    const { html } = send.mock.calls[0][0];
    expect(html).toContain('Clara Schumann');
  });
});
