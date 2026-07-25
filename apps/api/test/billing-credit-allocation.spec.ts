/**
 * Prepaid credit allocation maths.
 *
 * Guards the fix for the on-account double-count: an on-account payment mints
 * whole prepaid lessons, and the pence those lessons cost (`allocated`) is
 * banked off the family's cash balance so the same money is never counted both
 * as a positive balance and as the free lessons the credits pay for.
 *
 * `planPrepaidCredits` is the pure core; it takes the convertible pot (the
 * family's positive balance after the payment) rather than the raw payment,
 * which is what lets a payment clear debt before anything is banked as lessons.
 */
import { planPrepaidCredits } from '../src/billing/billing.service';

const enrol = (enrollmentId: string, rate: number, studentId = enrollmentId + '-s') =>
  ({ studentId, enrollmentId, rate });

describe('planPrepaidCredits', () => {
  it('converts a clean pot into whole lessons with nothing left over', () => {
    const { credits, allocated } = planPrepaidCredits([enrol('e1', 2500)], 10000);
    expect(credits).toHaveLength(4);
    expect(allocated).toBe(10000); // exactly £100 → 4 × £25, remainder 0
  });

  it('only banks whole lessons, leaving the fractional remainder as pence', () => {
    const { credits, allocated } = planPrepaidCredits([enrol('e1', 2500)], 11000);
    expect(credits).toHaveLength(4);
    expect(allocated).toBe(10000); // £110 → 4 lessons (£100); £10 stays on balance
  });

  it('never converts more than the pot — a family in debt (pot 0) banks nothing', () => {
    // Caller passes pot = max(0, balanceAfterPayment); an in-debt family clears to
    // a non-positive balance, so there is no surplus to turn into lessons.
    const { credits, allocated } = planPrepaidCredits([enrol('e1', 2500)], 0);
    expect(credits).toHaveLength(0);
    expect(allocated).toBe(0);
  });

  it('respects a partial surplus: £50 left after clearing debt buys 2 lessons', () => {
    const { credits, allocated } = planPrepaidCredits([enrol('e1', 2500)], 5000);
    expect(credits).toHaveLength(2);
    expect(allocated).toBe(5000);
  });

  it('splits across students proportionally by rate and never over-allocates the pot', () => {
    const plan = planPrepaidCredits([enrol('cheap', 2000), enrol('dear', 4000)], 12000);
    // Shares: cheap 4000 → 2 lessons (£40), dear 8000 → 2 lessons (£80) = £120 exactly.
    const perEnrol = (id: string) => plan.credits.filter(c => c.enrollmentId === id).length;
    expect(perEnrol('cheap')).toBe(2);
    expect(perEnrol('dear')).toBe(2);
    expect(plan.allocated).toBe(12000);
    expect(plan.allocated).toBeLessThanOrEqual(12000);
  });

  it('returns nothing when there are no billable enrolments', () => {
    expect(planPrepaidCredits([], 10000)).toEqual({ credits: [], allocated: 0 });
  });

  it('is safe against a nonsensical negative pot', () => {
    expect(planPrepaidCredits([enrol('e1', 2500)], -5000)).toEqual({ credits: [], allocated: 0 });
  });
});
