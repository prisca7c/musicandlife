import { BillingService } from '../src/billing/billing.service';

/**
 * recordPayment used to silently discard ANY payment on an already-'paid'
 * invoice, returning the prior payment with no new insert. That's correct for
 * a manual/cash re-submit with no way to prove it's a retry vs a new payment
 * — but a webhook-verified card payment (dto.providerRef set) that reaches
 * this point already passed the dedupeKey fast-path, meaning it's a
 * genuinely DIFFERENT, real transaction (e.g. two tabs each completing a real
 * Mollie checkout before either webhook lands). Discarding it dropped real
 * captured money with no payment row, no ledger entry, no trace anywhere.
 */
const ORG = 'org-1';
const FAM = 'fam-1';
const INV = 'inv-1';

function makeService(opts: { dedupeExists?: boolean } = {}) {
  const inserted: { table: string; values: Record<string, unknown> }[] = [];
  const family = { id: FAM, organizationId: ORG, balanceCached: 0 };
  const invoice = { id: INV, organizationId: ORG, familyId: FAM, status: 'paid', total: 5000 };
  const priorPayment = { id: 'pay-old', invoiceId: INV, amount: 5000 };

  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({ for: async () => [family] }),
      }),
    }),
    query: {
      invoices: { findFirst: async () => invoice },
      payments: { findFirst: async () => priorPayment },
    },
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        const name = (table as { __name?: string }).__name ?? 'unknown';
        inserted.push({ table: name, values: v });
        return { returning: async () => [{ id: 'pay-new', ...v }] };
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };

  const db = {
    db: {
      query: {
        payments: { findFirst: async () => (opts.dedupeExists ? priorPayment : undefined) },
      },
      transaction: async (fn: (tx: unknown) => unknown) => fn(tx),
    },
  };
  return { service: new BillingService(db as never), inserted };
}

jest.mock('@music-life/db', () => {
  const actual = jest.requireActual('@music-life/db');
  return {
    ...actual,
    payments: Object.assign(actual.payments, { __name: 'payments' }),
    ledgerEntries: Object.assign(actual.ledgerEntries, { __name: 'ledgerEntries' }),
  };
});

describe('BillingService.recordPayment — a second verified card payment is not dropped', () => {
  it('records a new payment + ledger entry for a providerRef payment on an already-paid invoice', async () => {
    const { service, inserted } = makeService();
    const result = await service.recordPayment(ORG, {
      familyId: FAM, invoiceId: INV, method: 'card', amount: 5000, providerRef: 'tr_second_charge',
    } as never);

    expect((result as { id: string }).id).toBe('pay-new');
    expect(inserted.some(i => i.table === 'payments')).toBe(true);
    expect(inserted.some(i => i.table === 'ledgerEntries')).toBe(true);
  });

  it('still returns the prior payment (no new insert) for a no-providerRef payment on an already-paid invoice', async () => {
    const { service, inserted } = makeService();
    const result = await service.recordPayment(ORG, {
      familyId: FAM, invoiceId: INV, method: 'cash', amount: 5000,
    } as never);

    expect((result as { id: string }).id).toBe('pay-old');
    expect(inserted).toHaveLength(0);
  });

  it('the fast-path dedupeKey check still short-circuits a true retry of the same card payment', async () => {
    const { service, inserted } = makeService({ dedupeExists: true });
    const result = await service.recordPayment(ORG, {
      familyId: FAM, invoiceId: INV, method: 'card', amount: 5000, providerRef: 'tr_second_charge',
    } as never);

    expect((result as { id: string }).id).toBe('pay-old');
    expect(inserted).toHaveLength(0);
  });
});
