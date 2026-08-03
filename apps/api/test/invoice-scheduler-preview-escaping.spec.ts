import { InvoiceSchedulerWorker } from '../src/billing/invoice-scheduler.worker';

/**
 * The "N invoices going out in 3 days" preview summary emailed to admins embeds
 * each due family's name in an HTML list. The family name is user-supplied (a
 * parent types familyName/contactName on the public registration form, or it
 * comes from a CSV import) and the branded email template renders ctx.body as
 * raw HTML — so an unescaped name is stored HTML injection into the admin inbox
 * (a phishing link, a tracking pixel). This guards that the name is escaped.
 */
function makeWorker(familyName: string) {
  // anchorDay 15 + offset 0, clock pinned to the 12th ⇒ daysUntil === 3 === PREVIEW_DAYS_AHEAD.
  const family = {
    id: 'fam-1',
    organizationId: 'org-1',
    name: familyName,
    billingStartDate: '2026-06-15T12:00:00',
    invoiceDateOffsetDays: 0,
    billingMode: 'postpaid' as const,
    invoiceMode: 'monthly_statement' as const,
    autoEmailInvoice: false,
    email: null as string | null,
  };

  const trigger = jest.fn().mockResolvedValue(undefined);
  const db = {
    db: {
      query: {
        families: { findMany: jest.fn().mockResolvedValue([family]) },
        invoices: { findFirst: jest.fn().mockResolvedValue(undefined) },
        memberships: { findMany: jest.fn().mockResolvedValue([{ user: { email: 'admin@studio.test' } }]) },
      },
    },
  };
  const billing = { createInvoice: jest.fn(), sendInvoice: jest.fn() };
  const notifications = { trigger };

  const worker = new InvoiceSchedulerWorker(db as never, billing as never, notifications as never);
  return { worker, trigger };
}

describe('InvoiceSchedulerWorker — preview summary name escaping', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 5, 12, 6, 0, 0)); // local 2026-06-12 06:00 → 3 days before the 15th
  });
  afterAll(() => jest.useRealTimers());

  it('HTML-escapes the family name in the admin preview email', async () => {
    const { worker, trigger } = makeWorker('<img src=x onerror=alert(1)> & Sons');
    await (worker as unknown as { scan: () => Promise<void> }).scan();

    expect(trigger).toHaveBeenCalledTimes(1);
    const ctx = trigger.mock.calls[0]![1] as { body: string };
    expect(ctx.body).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; Sons');
    expect(ctx.body).not.toContain('<img');
  });

  it('leaves an ordinary family name readable', async () => {
    const { worker, trigger } = makeWorker('The Bell Family');
    await (worker as unknown as { scan: () => Promise<void> }).scan();
    const ctx = trigger.mock.calls[0]![1] as { body: string };
    expect(ctx.body).toContain('<li>The Bell Family</li>');
  });
});
