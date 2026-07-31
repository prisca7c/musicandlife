/**
 * Bank-statement column detection.
 *
 * Guards the fix for a catastrophic mis-credit: the amount column was found with
 * find('amount','value'), so a "Value Date" column (its header contains "value")
 * won the match whenever it sorted before the real "Amount" column and no
 * "Paid In" column was present (common on business/corporate exports). Every
 * row's amount then became its date parsed as a number — "01/07/2026" → 1072026
 * → £1,072,026 — credited on account to any family whose reference matched.
 */
import { ReconciliationService, parseMoney } from '../src/billing/reconciliation.service';

// parseCsv touches neither db nor billing, so a bare instance is enough.
const svc = new ReconciliationService(null as never, null as never);

describe('parseCsv column detection', () => {
  it('does not let a "Value Date" column masquerade as the amount', () => {
    const csv = [
      'Date,Value Date,Description,Amount',
      '01/07/2026,01/07/2026,SMITH ML-4F2A,45.00',
    ].join('\n');
    const { rows, skipped } = svc.parseCsv(csv);
    expect(skipped).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(4500);          // £45.00, NOT £1,072,026
    expect(rows[0]!.description).toBe('SMITH ML-4F2A');
  });

  it('still reads NatWest/RBS "Value" as the amount column', () => {
    const csv = ['Date,Type,Description,Value,Balance', '01/07/2026,BAC,SMITH,45.00,120.00'].join('\n');
    const { rows } = svc.parseCsv(csv);
    expect(rows[0]!.amount).toBe(4500);
  });

  it('prefers a Paid In column and ignores debit-only rows', () => {
    const csv = [
      'Date,Description,Paid Out,Paid In',
      '01/07/2026,TEACHER PAYROLL,200.00,',
      '02/07/2026,SMITH ML-4F2A,,45.00',
    ].join('\n');
    const { rows, skipped } = svc.parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(1);
    expect(rows[0]!.amount).toBe(4500);
  });

  it('errors rather than guessing when only a date-like value column exists', () => {
    const csv = ['Date,Value Date,Description', '01/07/2026,01/07/2026,SMITH'].join('\n');
    expect(() => svc.parseCsv(csv)).toThrow(/amount column/i);
  });
});

describe('parseMoney (the reason the hijack was dangerous)', () => {
  it('turns a slash date into a large positive number that would import', () => {
    expect(parseMoney('01/07/2026')).toBe(107202600); // documents why the column fix matters
  });
});
