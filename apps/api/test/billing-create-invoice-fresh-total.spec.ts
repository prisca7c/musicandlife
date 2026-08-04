import { BillingService } from '../src/billing/billing.service';

/**
 * createInvoice inserts the invoice with total = 0 (the column default), THEN
 * generateLessonLineItems itemises the period and updates invoices.total to the
 * real amount. The method must return the post-itemisation row, not the stale
 * insert snapshot — otherwise callers see £0. The auto-invoice scheduler emails
 * "Invoice … for £{total} is now available", so a stale total made every
 * auto-emailed statement claim £0.00 no matter what the family actually owed.
 * createInvoicesPerClass already re-reads for exactly this reason.
 */

function makeService(reReadTotal: number) {
  const inserted = { id: 'inv-1', number: 'INV-1', total: 0, status: 'draft' };
  const db = {
    db: {
      query: {
        families: {
          findFirst: async () => ({ id: 'fam-1', organizationId: 'org-1', dueDateOffsetDays: 7 }),
        },
        invoices: {
          // The re-read after itemisation returns the updated total.
          findFirst: async () => ({ ...inserted, total: reReadTotal }),
        },
      },
      insert: () => ({ values: () => ({ returning: async () => [inserted] }) }),
    },
  };
  const svc = new BillingService(db as never);
  // Stub the two collaborators so we isolate the return-value behaviour.
  Object.assign(svc as object, {
    nextInvoiceNumber: async () => 'INV-1',
    generateLessonLineItems: async () => undefined, // it "updates" total; the re-read supplies it
  });
  return svc;
}

const create = (svc: BillingService, itemize?: boolean) =>
  (svc as never as {
    createInvoice: (o: string, dto: Record<string, unknown>) => Promise<{ total: number }>;
  }).createInvoice('org-1', {
    familyId: 'fam-1', mode: 'monthly_statement',
    periodStart: '2026-08-01', periodEnd: '2026-08-31',
    ...(itemize === false ? { itemizeLessons: false } : {}),
  });

describe('BillingService.createInvoice — returns the itemised total, not the £0 insert default', () => {
  it('returns the post-itemisation total (re-read), not the stale 0', async () => {
    const svc = makeService(24000); // £240 of lessons
    const inv = await create(svc);
    expect(inv.total).toBe(24000);
  });

  it('an empty period still returns 0 (nothing to bill)', async () => {
    const svc = makeService(0);
    const inv = await create(svc);
    expect(inv.total).toBe(0);
  });

  it('the manual empty-shell path (itemizeLessons:false) is unchanged — no re-read, stays 0', async () => {
    // Even if the invoices table somehow held a non-zero total, the shell path must
    // not re-read; it returns the freshly-inserted 0 for manual line-item entry.
    const svc = makeService(99999);
    const inv = await create(svc, false);
    expect(inv.total).toBe(0);
  });
});
