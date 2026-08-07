import { ReportsService } from '../src/reports/reports.service';

// The reports date range treats `to` as an INCLUSIVE calendar day. Computing the
// upper bound as a bare `new Date(to)` lands on 00:00Z of that day, so a
// `lte(col, bound)` filter drops everything that happened *during* the final day
// — a revenue report "1–31 Aug" silently omits the 31st's payments, and (with
// the default `to = today`) the dashboard's own revenue omits everything today.
// The fix reuses payroll's `periodEndInclusive`, so every upper bound must be
// 23:59:59.999Z of the `to` day. We capture the value drizzle's `lte` receives.

const lteCalls: unknown[] = [];
jest.mock('drizzle-orm', () => {
  const actual = jest.requireActual('drizzle-orm');
  return {
    ...actual,
    lte: (col: unknown, value: unknown) => {
      lteCalls.push(value);
      return actual.lte(col, value);
    },
  };
});

// A query builder whose from/where/groupBy all chain and resolve to [] when awaited.
function emptyBuilder() {
  const builder: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'groupBy', 'orderBy', 'innerJoin']) {
    builder[m] = () => builder;
  }
  (builder as { then: unknown }).then = (resolve: (v: unknown[]) => unknown) => resolve([]);
  return builder;
}

function makeService(settings: Record<string, unknown> | null) {
  const db = {
    db: {
      select: () => emptyBuilder(),
      query: {
        organizations: { findFirst: jest.fn().mockResolvedValue({ id: 'org', settings }) },
        lessons: { findMany: jest.fn().mockResolvedValue([]) },
      },
    },
  };
  return new ReportsService(db as never, {} as never);
}

function endOfDayFor(to: string): string {
  const d = new Date(to);
  d.setUTCHours(23, 59, 59, 999);
  return d.toISOString();
}

describe('ReportsService — inclusive `to` boundary', () => {
  beforeEach(() => { lteCalls.length = 0; });

  it('getAttendanceReport bounds the final day at 23:59:59.999Z, not midnight', async () => {
    const svc = makeService(null);
    await svc.getAttendanceReport('org', '2026-08-01', '2026-08-31');
    const dates = lteCalls.filter((v): v is Date => v instanceof Date);
    expect(dates.length).toBeGreaterThan(0);
    for (const d of dates) expect(d.toISOString()).toBe(endOfDayFor('2026-08-31'));
    // Regression guard: a bare `new Date(to)` would have been 00:00Z.
    expect(dates[0]!.toISOString()).not.toBe(new Date('2026-08-31').toISOString());
  });

  it('getRevenueReport (cash) includes the whole final day', async () => {
    const svc = makeService(null);
    await svc.getRevenueReport('org', '2026-08-01', '2026-08-31');
    const dates = lteCalls.filter((v): v is Date => v instanceof Date);
    expect(dates.length).toBeGreaterThan(0);
    for (const d of dates) expect(d.toISOString()).toBe(endOfDayFor('2026-08-31'));
  });
});
