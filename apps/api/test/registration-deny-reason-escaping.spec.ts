import { RegistrationService } from '../src/registration/registration.service';

/**
 * Denying a registration emails the family the reason, rendered as raw HTML by
 * the registration.denied template — the one trigger() call in this file that
 * was missed when contactName/studentFirstName/LastName were escaped elsewhere.
 * Reachable by a receptionist (not just an admin), so an unescaped reason is
 * stored HTML injection into the family's inbox.
 */
function makeService(reg: Record<string, unknown>) {
  const trigger = jest.fn().mockResolvedValue(undefined);
  const updated: Record<string, unknown>[] = [];
  const db = {
    db: {
      query: {
        registrations: { findFirst: jest.fn().mockResolvedValue(reg) },
      },
      update: () => ({
        set: (v: Record<string, unknown>) => ({ where: async () => { updated.push(v); return undefined; } }),
      }),
    },
  };
  const notifications = { trigger };
  const email = { addContact: jest.fn(), send: jest.fn() };
  const svc = new RegistrationService(db as never, notifications as never, email as never);
  return { svc, trigger };
}

describe('RegistrationService.deny — reason escaping', () => {
  it('escapes an HTML denial reason before emailing the family', async () => {
    const { svc, trigger } = makeService({
      id: 'reg-1', status: 'pending',
      payload: { contactEmail: 'parent@example.com' },
    });
    await svc.deny('org-1', 'reg-1', 'staff-1', '<img src=x onerror=alert(1)> please reapply');

    const call = trigger.mock.calls.find((c) => c[0] === 'registration.denied')!;
    const ctx = call[1] as { body: string };
    expect(ctx.body).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(ctx.body).not.toContain('<img');
  });

  it('leaves an ordinary reason readable', async () => {
    const { svc, trigger } = makeService({
      id: 'reg-1', status: 'pending',
      payload: { contactEmail: 'parent@example.com' },
    });
    await svc.deny('org-1', 'reg-1', 'staff-1', 'We are fully booked for this term.');

    const call = trigger.mock.calls.find((c) => c[0] === 'registration.denied')!;
    const ctx = call[1] as { body: string };
    expect(ctx.body).toBe('We are fully booked for this term.');
  });
});
