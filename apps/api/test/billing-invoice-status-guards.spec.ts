import { BillingService } from '../src/billing/billing.service';
import { BadRequestException } from '@nestjs/common';

/**
 * sendInvoice and addLineItem must refuse to act on an invoice that has left
 * 'draft'. Without this, re-sending an already-void invoice reissued a charge
 * for something that was supposed to be cancelled (a stale "Send" click
 * double-billed the family), and adding a line to a 'paid' invoice bumped its
 * total without ever charging the extra amount — an invoice that read "Paid"
 * while actually under-billed.
 */

function makeService(invoice: { id: string; status: string; total: number; familyId: string }) {
  const db = {
    db: {
      query: {
        invoices: { findFirst: async () => ({ ...invoice, issuedOn: '2026-08-01', family: {}, lineItems: [] }) },
        families: { findFirst: async () => ({ id: invoice.familyId }) },
        ledgerEntries: { findMany: async () => [] },
      },
      transaction: async (fn: (tx: unknown) => unknown) => fn({}),
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [invoice] }) }) }),
      insert: () => ({ values: () => ({ returning: async () => [{ id: 'li-1' }] }) }),
    },
  };
  return new BillingService(db as never);
}

describe('BillingService — invoice status guards', () => {
  it('sendInvoice refuses a non-draft invoice (void)', async () => {
    const svc = makeService({ id: 'inv-1', status: 'void', total: 5000, familyId: 'fam-1' });
    await expect(svc.sendInvoice('org-1', 'inv-1')).rejects.toThrow(BadRequestException);
  });

  it('sendInvoice refuses a non-draft invoice (paid)', async () => {
    const svc = makeService({ id: 'inv-1', status: 'paid', total: 5000, familyId: 'fam-1' });
    await expect(svc.sendInvoice('org-1', 'inv-1')).rejects.toThrow(BadRequestException);
  });

  it('addLineItem refuses to edit a paid invoice', async () => {
    const svc = makeService({ id: 'inv-1', status: 'paid', total: 5000, familyId: 'fam-1' });
    await expect(svc.addLineItem('org-1', 'inv-1', 'Extra lesson', 3000)).rejects.toThrow(BadRequestException);
  });

  it('addLineItem refuses to edit a void invoice', async () => {
    const svc = makeService({ id: 'inv-1', status: 'void', total: 0, familyId: 'fam-1' });
    await expect(svc.addLineItem('org-1', 'inv-1', 'Extra lesson', 3000)).rejects.toThrow(BadRequestException);
  });
});
