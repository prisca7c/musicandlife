import { RegistrationService } from '../src/registration/registration.service';

/**
 * The public registration form is unauthenticated, and on submit it emails the
 * studio admin ("New registration from <contactName> for <student>") plus a
 * confirmation to the registrant. Those bodies are rendered as raw HTML by the
 * notification templates, so the caller-supplied names must be escaped —
 * otherwise anyone could inject markup (a phishing link, a tracking pixel) into
 * the studio admin's inbox with no login. This guards that escaping.
 */
function makeService() {
  const trigger = jest.fn().mockResolvedValue(undefined);
  const db = {
    db: {
      query: {
        organizations: { findFirst: jest.fn().mockResolvedValue({ id: 'org-1', slug: 'music-and-life' }) },
        registrations: { findFirst: jest.fn().mockResolvedValue(undefined) },
      },
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({ returning: async () => [{ id: 'reg-1' }] }),
        }),
      }),
    },
  };
  const notifications = { trigger };
  const email = { addContact: jest.fn(), send: jest.fn() };
  const svc = new RegistrationService(db as never, notifications as never, email as never);
  return { svc, trigger };
}

const dto = {
  contactName: '<img src=x onerror=alert(1)>',
  studentFirstName: '<b>Bo',
  studentLastName: 'Diddley & Co',
  contactEmail: 'parent@example.com',
} as never;

describe('RegistrationService.submit — notification name escaping', () => {
  it('escapes caller-supplied names in the admin + confirmation emails', async () => {
    const { svc, trigger } = makeService();
    await svc.submit('music-and-life', dto);

    const byEvent = new Map(trigger.mock.calls.map((c) => [c[0], c[1] as { body: string }]));

    const admin = byEvent.get('registration.received')!;
    expect(admin.body).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(admin.body).toContain('&lt;b&gt;Bo');
    expect(admin.body).toContain('Diddley &amp; Co');
    expect(admin.body).not.toContain('<img');
    expect(admin.body).not.toContain('<b>Bo');

    const confirm = byEvent.get('registration.submitted')!;
    expect(confirm.body).toContain('&lt;b&gt;Bo');
    expect(confirm.body).not.toContain('<b>Bo');
  });
});
