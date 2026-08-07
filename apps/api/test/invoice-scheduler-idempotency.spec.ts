import { InvoiceSchedulerWorker } from '../src/billing/invoice-scheduler.worker';

// The scheduler must not auto-generate a second invoice for a period a family has
// already been billed for. The daily cron normally hits the invoice day once, but
// a redeploy that replays a missed job, a manual run, or any same-day re-entry
// calls scan() again; the advisory lock only serialises concurrent runs. Without
// the per-period guard the family gets duplicate monthly statements.

function makeWorker(existingInvoice: { id: string } | undefined) {
  // anchorDay 15 + offset 0 with the clock pinned to the 15th ⇒ daysUntil === 0.
  const family = {
    id: 'fam-1',
    organizationId: 'org-1',
    name: 'Test Family',
    billingStartDate: '2026-06-15T12:00:00', // noon keeps getDate()===15 in any realistic tz
    invoiceDateOffsetDays: 0,
    billingMode: 'postpaid' as const,
    invoiceMode: 'monthly_statement' as const,
    autoEmailInvoice: false,
    email: null as string | null,
  };

  const createInvoice = jest.fn().mockResolvedValue({ id: 'inv-1', number: 'INV-1', total: 9000, dueDate: '2026-07-15' });
  const invoicesFindFirst = jest.fn().mockResolvedValue(existingInvoice);

  const db = {
    db: {
      query: {
        families: { findMany: jest.fn().mockResolvedValue([family]) },
        invoices: { findFirst: invoicesFindFirst },
        memberships: { findMany: jest.fn().mockResolvedValue([]) },
        organizations: { findFirst: jest.fn().mockResolvedValue({ timezone: 'Europe/London' }) },
      },
    },
  };
  const billing = { createInvoice, sendInvoice: jest.fn() };
  const notifications = { trigger: jest.fn() };

  const worker = new InvoiceSchedulerWorker(db as never, billing as never, notifications as never);
  return { worker, createInvoice, invoicesFindFirst };
}

describe('InvoiceSchedulerWorker.scan — per-period idempotency', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 5, 15, 6, 0, 0)); // local 2026-06-15 06:00
  });
  afterAll(() => jest.useRealTimers());

  it('creates an invoice when none exists for the period', async () => {
    const { worker, createInvoice, invoicesFindFirst } = makeWorker(undefined);
    await (worker as unknown as { scan: () => Promise<void> }).scan();
    expect(invoicesFindFirst).toHaveBeenCalledTimes(1);
    expect(createInvoice).toHaveBeenCalledTimes(1);
  });

  it('skips creation when the family is already invoiced for the period', async () => {
    const { worker, createInvoice, invoicesFindFirst } = makeWorker({ id: 'existing-inv' });
    await (worker as unknown as { scan: () => Promise<void> }).scan();
    expect(invoicesFindFirst).toHaveBeenCalledTimes(1);
    expect(createInvoice).not.toHaveBeenCalled();
  });
});
