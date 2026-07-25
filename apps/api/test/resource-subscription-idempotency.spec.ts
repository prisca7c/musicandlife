import { BillingService } from '../src/billing/billing.service';

/**
 * The family portal's "Subscribe" button POSTs an argument-less request that
 * charges the family and issues an invoice. Without a guard, a double-tap / two
 * open tabs / a back-button re-POST raises a SECOND invoice (and email) and
 * stacks a second paid-until period — charging the family twice for one intent.
 *
 * chargeResourceSubscription now returns an already-outstanding (unpaid)
 * subscription invoice instead of charging again, while still allowing a genuine
 * renewal once the prior invoice has been reconciled to 'paid'.
 */
function makeService(opts: {
  resourceAccessPaidUntil: string | null;
  outstandingInvoices: { id: string; number: string; lineItems: { description: string }[] }[];
}) {
  const updateWhere = jest.fn().mockResolvedValue(undefined);
  const mockDb = {
    query: {
      families: {
        findFirst: jest.fn().mockResolvedValue({ id: 'fam-1', resourceAccessPaidUntil: opts.resourceAccessPaidUntil }),
      },
      organizations: {
        findFirst: jest.fn().mockResolvedValue({ settings: { resourceSubscriptionPrice: 600, resourceSubscriptionMonths: 1 } }),
      },
      invoices: {
        findMany: jest.fn().mockResolvedValue(opts.outstandingInvoices),
      },
    },
    update: jest.fn(() => ({ set: jest.fn(() => ({ where: updateWhere })) })),
  };

  const service = new BillingService({ db: mockDb } as never);
  const createInvoice = jest.spyOn(service, 'createInvoice').mockResolvedValue({ id: 'inv-new', number: 'INV-NEW' } as never);
  jest.spyOn(service, 'addLineItem').mockResolvedValue({} as never);
  jest.spyOn(service, 'sendInvoice').mockResolvedValue({} as never);
  return { service, createInvoice, updateWhere };
}

describe('chargeResourceSubscription — idempotency', () => {
  it('charges once when there is no outstanding subscription invoice', async () => {
    const { service, createInvoice } = makeService({ resourceAccessPaidUntil: null, outstandingInvoices: [] });
    const res = await service.chargeResourceSubscription('org-1', 'fam-1');
    expect(createInvoice).toHaveBeenCalledTimes(1);
    expect((res as { alreadyPending?: boolean }).alreadyPending).toBeFalsy();
    expect(res.invoiceId).toBe('inv-new');
  });

  it('returns the existing invoice (no second charge) when an unpaid subscription invoice already exists', async () => {
    const { service, createInvoice } = makeService({
      resourceAccessPaidUntil: '2026-09-01',
      outstandingInvoices: [
        { id: 'inv-old', number: 'INV-OLD', lineItems: [{ description: 'Resource library access — 1 month' }] },
      ],
    });
    const res = await service.chargeResourceSubscription('org-1', 'fam-1');
    expect(createInvoice).not.toHaveBeenCalled();
    expect((res as { alreadyPending?: boolean }).alreadyPending).toBe(true);
    expect(res.invoiceId).toBe('inv-old');
    expect(res.invoiceNumber).toBe('INV-OLD');
  });

  it('does NOT treat an unrelated outstanding invoice (e.g. lessons) as a subscription', async () => {
    const { service, createInvoice } = makeService({
      resourceAccessPaidUntil: null,
      outstandingInvoices: [
        { id: 'inv-lessons', number: 'INV-L', lineItems: [{ description: 'Piano lessons — June' }] },
      ],
    });
    const res = await service.chargeResourceSubscription('org-1', 'fam-1');
    expect(createInvoice).toHaveBeenCalledTimes(1);
    expect(res.invoiceId).toBe('inv-new');
  });
});
