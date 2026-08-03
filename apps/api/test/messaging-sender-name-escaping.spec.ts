import { MessagingService } from '../src/messaging/messaging.service';

/**
 * A new-message email escapes the message body ("a message is user-typed and
 * lands in an HTML email") — but the SENDER NAME embedded right beside it was
 * not. The name is the family's own contactName from the public registration
 * form, so a family could set it to markup (a phishing link, a tracking pixel)
 * that renders in their teacher's inbox. Both must be escaped.
 */

type Row = Record<string, unknown>;

function makeService(guardianContactName: string) {
  const captured: { body?: string; subject?: string } = {};

  const db = {
    db: {
      query: {
        memberships: { findMany: async () => [{ userId: 'g-1', baseRole: 'guardian', user: { id: 'g-1', email: 'p@x.co' } }] },
        staffMembers: { findMany: async () => [] as Row[] },
        students: { findMany: async () => [] as Row[] },
        guardians: { findMany: async () => [{ userId: 'g-1', family: { contactName: guardianContactName, name: null } }] },
      },
    },
  };

  const notifications = {
    trigger: async (_event: string, ctx: { body: string; subject?: string }) => {
      captured.body = ctx.body;
      captured.subject = ctx.subject;
    },
  };

  const svc = new MessagingService(db as never, {} as never, notifications as never);
  return { svc, captured };
}

const notify = (svc: MessagingService, body: string) =>
  (svc as never as {
    notifyNewMessage: (orgId: string, threadId: string, senderId: string, body: string, recipients: Row[]) => Promise<void>;
  }).notifyNewMessage('org-1', 'th-1', 'g-1', body, [{ userId: 't-1', email: 'teacher@x.co' }]);

describe('MessagingService.notifyNewMessage — sender name is HTML-escaped', () => {
  it('escapes markup in the sender name so it cannot inject into the email', async () => {
    const { svc, captured } = makeService('<img src=x onerror=alert(1)>');
    await notify(svc, 'hello');
    expect(captured.body).not.toContain('<img');
    expect(captured.body).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('still escapes the message body too', async () => {
    const { svc, captured } = makeService('Jo Bloggs');
    await notify(svc, 'see <script>evil</script>');
    expect(captured.body).not.toContain('<script>');
    expect(captured.body).toContain('&lt;script&gt;evil&lt;/script&gt;');
    // A benign name passes through readably.
    expect(captured.body).toContain('Jo Bloggs');
  });
});
