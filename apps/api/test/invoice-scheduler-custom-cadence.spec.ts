import { nextCustomInvoiceDate, resolveCustomBillingPeriod } from '../src/billing/invoice-scheduler.worker';

// Local-calendar-day formatter, not .toISOString() — the test machine may run
// in a zone ahead of UTC, where toISOString on a local-midnight Date renders
// the *previous* day and makes an otherwise-correct result look off-by-one.
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The custom cadence (an arbitrary N days/weeks/months/years, not the fixed
// monthly anchor-day the other two invoice modes use) is new scheduling math —
// exactly the kind of off-by-one that has bitten this billing worker before
// (see nextInvoiceDate's own history). Verify it directly rather than only via
// the full scan() integration path.
describe('nextCustomInvoiceDate', () => {
  it('returns the anchor itself when it is still in the future', () => {
    const anchor = new Date(2026, 5, 15); // 15 Jun 2026
    const from = new Date(2026, 5, 1); // 1 Jun 2026
    const next = nextCustomInvoiceDate(anchor, 2, 'week', from);
    expect(ymd(next)).toBe('2026-06-15');
  });

  it('steps forward by whole intervals to the first occurrence on/after "from" (weekly)', () => {
    const anchor = new Date(2026, 0, 5); // 5 Jan 2026 (Monday)
    const from = new Date(2026, 5, 15); // 15 Jun 2026
    const next = nextCustomInvoiceDate(anchor, 1, 'week', from);
    // Every Monday from Jan 5 — the occurrence on/after Jun 15 is Jun 15 itself
    // (a Monday), not Jun 22.
    expect(next.getDay()).toBe(1);
    expect(next.getTime()).toBeGreaterThanOrEqual(from.getTime());
    expect(ymd(next)).toBe('2026-06-15');
  });

  it('steps forward correctly for a multi-month custom interval', () => {
    const anchor = new Date(2026, 0, 1); // 1 Jan 2026
    const from = new Date(2026, 4, 15); // 15 May 2026
    // Every 2 months: Jan 1, Mar 1, May 1, Jul 1 — first on/after May 15 is Jul 1.
    const next = nextCustomInvoiceDate(anchor, 2, 'month', from);
    expect(ymd(next)).toBe('2026-07-01');
  });

  it('clamps an interval of 0 or less to at least 1 (never loops forever / never fires same-day)', () => {
    const anchor = new Date(2026, 0, 1);
    const from = new Date(2026, 0, 1);
    const next = nextCustomInvoiceDate(anchor, 0, 'day', from);
    expect(ymd(next)).toBe('2026-01-01');
  });
});

describe('resolveCustomBillingPeriod', () => {
  it('postpaid: period ends the day before the invoice date, spans exactly one interval', () => {
    const invoiceDate = new Date(2026, 6, 15); // 15 Jul 2026
    const { periodStart, periodEnd } = resolveCustomBillingPeriod('postpaid', invoiceDate, 2, 'week');
    expect(periodStart).toBe('2026-07-01');
    expect(periodEnd).toBe('2026-07-14');
  });

  it('prepaid: period starts on the invoice date, spans exactly one interval', () => {
    const invoiceDate = new Date(2026, 6, 1); // 1 Jul 2026
    const { periodStart, periodEnd } = resolveCustomBillingPeriod('prepaid', invoiceDate, 1, 'month');
    expect(periodStart).toBe('2026-07-01');
    expect(periodEnd).toBe('2026-07-31');
  });
});
