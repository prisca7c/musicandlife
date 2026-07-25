import { periodEndInclusive } from '../src/payroll/payroll.service';

// The payroll UI sends period bounds as bare calendar dates (<input type="date">),
// so periodEnd parses to midnight UTC. Billing lessons with `startsAt <= end`
// against that raw value drops every lesson on the final day of the period —
// a silent underpayment. periodEndInclusive extends the bound to the end of the
// calendar day so the whole last day is paid.
describe('periodEndInclusive — payroll period end boundary', () => {
  it('extends a bare date to the end of that UTC calendar day', () => {
    const inclusive = periodEndInclusive(new Date('2026-06-30'));
    expect(inclusive.toISOString()).toBe('2026-06-30T23:59:59.999Z');
  });

  it('includes a lesson at any time on the final day', () => {
    const end = periodEndInclusive(new Date('2026-06-30'));
    // A 2pm lesson on the last day of the period — previously excluded.
    const lessonAt2pm = new Date('2026-06-30T14:00:00.000Z');
    expect(lessonAt2pm <= end).toBe(true);
    // A lesson one second into the next day is still correctly excluded.
    const nextDay = new Date('2026-07-01T00:00:00.000Z');
    expect(nextDay <= end).toBe(false);
  });

  it('regression: the raw (un-extended) bound would drop the final day', () => {
    const raw = new Date('2026-06-30');
    const lessonAt2pm = new Date('2026-06-30T14:00:00.000Z');
    // Demonstrates the original bug: with the raw midnight bound, the lesson
    // fails the `<=` check and is never paid.
    expect(lessonAt2pm <= raw).toBe(false);
  });

  it('does not mutate the input date', () => {
    const input = new Date('2026-06-30');
    periodEndInclusive(input);
    expect(input.toISOString()).toBe('2026-06-30T00:00:00.000Z');
  });
});
