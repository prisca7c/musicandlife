/**
 * Guards the claim/bank double-credit hole.
 *
 * When a transfer lands BEFORE the family taps "I've paid", the importer credits
 * the family on account and marks the line `matched`. The family's later claim
 * used to sit `pending` forever (the auto-match query looked for an `unmatched`
 * line with a family — a combination the importer never produces), so a staffer
 * confirming that claim recorded a SECOND payment for money already banked.
 *
 * Fix: confirmClaim (and the auto-match) settle the claim against the existing
 * bank payment instead of recording a new one. The load-bearing assertion below
 * is that billing.recordPayment is NOT called when money is already banked.
 */
import { ReconciliationService } from '../src/billing/reconciliation.service';

// A claim always belongs to one specific invoice now (the reference a family
// quotes IS that invoice's number) — findUnclaimedBankPayment narrows to a
// bank line whose already-recorded payment is for that SAME invoice, not
// just a matching amount, so the mock payments lookup matters here too.
function makeService(bankTxn: unknown, matchingPayment: unknown) {
  const recordPayment = jest.fn().mockResolvedValue({ id: 'pay-new' });
  const claim = {
    id: 'claim-1', organizationId: 'org-1', familyId: 'fam-1',
    invoiceId: 'inv-1', amount: 4500, status: 'pending' as const,
  };

  const setCalls: Array<{ table: string; values: Record<string, unknown> }> = [];
  const makeUpdate = (table: string) => () => ({
    set: (values: Record<string, unknown>) => {
      setCalls.push({ table, values });
      return { where: () => Promise.resolve([{}]) };
    },
  });

  const db = {
    db: {
      query: {
        paymentClaims: { findFirst: jest.fn().mockResolvedValue(claim) },
        bankTransactions: { findMany: jest.fn().mockResolvedValue(bankTxn ? [bankTxn] : []) },
        payments: { findMany: jest.fn().mockResolvedValue(matchingPayment ? [matchingPayment] : []) },
      },
      update: jest.fn((table: { _: { name?: string } }) => {
        // Drizzle table objects don't expose a clean name here; disambiguate by
        // call order isn't reliable, so tag via the two known tables' identity.
        return makeUpdate(table === (bankTransactions as unknown) ? 'bank' : 'claim')();
      }),
    },
  };
  const billing = { recordPayment };
  const svc = new ReconciliationService(db as never, billing as never);
  return { svc, recordPayment, setCalls };
}

// Imported so the update() tagger can compare table identity.
import { bankTransactions } from '@music-life/db';

describe('confirmClaim — no double credit when money already landed', () => {
  it('links to the existing bank payment instead of recording a new one', async () => {
    const bankTxn = {
      id: 'txn-1', paymentId: 'pay-bank', bookedOn: '2026-07-01',
      matchedFamilyId: 'fam-1', amount: 4500, status: 'matched', matchedClaimId: null,
    };
    const matchingPayment = { id: 'pay-bank', invoiceId: 'inv-1' };
    const { svc, recordPayment, setCalls } = makeService(bankTxn, matchingPayment);

    const res = await svc.confirmClaim('org-1', 'claim-1', 'user-1');

    expect(recordPayment).not.toHaveBeenCalled();          // ← the double-credit guard
    expect(res).toEqual({ status: 'confirmed', paymentId: 'pay-bank' });
    // claim points at the banked payment; the line is stamped with the claim.
    const claimSet = setCalls.find((c) => c.table === 'claim');
    expect(claimSet?.values).toMatchObject({ status: 'confirmed', paymentId: 'pay-bank', matchedTransactionId: 'txn-1' });
    const bankSet = setCalls.find((c) => c.table === 'bank');
    expect(bankSet?.values).toMatchObject({ matchedClaimId: 'claim-1' });
  });

  it('still records a real payment when nothing is already banked (genuine override)', async () => {
    const { svc, recordPayment } = makeService(undefined, undefined);

    const res = await svc.confirmClaim('org-1', 'claim-1', 'user-1');

    expect(recordPayment).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ status: 'confirmed', paymentId: 'pay-new' });
  });
});
