/**
 * Accrual-basis revenue headline sign.
 *
 * `charge` ledger entries are stored NEGATIVE (they debit the family balance).
 * getRevenueReport's headline used the raw charge sum for accrual mode, so the
 * "revenue earned" figure came out negative and rendered as e.g. "-£5,000" on
 * the reports page. Cash mode (payments, positive) was fine. The fix negates the
 * charge sum for accrual; this guards it.
 */
import { ReportsService } from '../src/reports/reports.service';

function makeService(accountingMode: 'cash' | 'accrual', entries: { type: string; total: string }[]) {
  const db = {
    db: {
      query: {
        organizations: { findFirst: jest.fn().mockResolvedValue({ settings: { accountingMode } }) },
        lessons: { findMany: jest.fn().mockResolvedValue([]) },
      },
      // select(...).from(...).where(...).groupBy(...) → entries
      select: jest.fn(() => ({
        from: () => ({ where: () => ({ groupBy: () => Promise.resolve(entries) }) }),
      })),
    },
  };
  return new ReportsService(db as never);
}

describe('getRevenueReport — accrual headline sign', () => {
  const charges = [{ type: 'charge', total: '-500000' }, { type: 'payment', total: '420000' }];

  it('reports accrual revenue as a positive number', async () => {
    const svc = makeService('accrual', charges);
    const res = await svc.getRevenueReport('org-1', '2026-07-01', '2026-07-31');
    expect(res.accountingMode).toBe('accrual');
    expect(res.total).toBe(500000); // +£5,000, not -£5,000
  });

  it('leaves cash revenue (payments, already positive) unchanged', async () => {
    const svc = makeService('cash', charges);
    const res = await svc.getRevenueReport('org-1', '2026-07-01', '2026-07-31');
    expect(res.accountingMode).toBe('cash');
    expect(res.total).toBe(420000);
  });
});
