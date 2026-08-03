/**
 * "Earned from completed lessons" valuation on the reports page.
 *
 * getRevenueReport summed each completed lesson with raw proratedAmount, which
 * ignores the two flat-price rules the real charge honours:
 *   - a TRIAL lesson bills its flat trialRate (often free/discounted), not the
 *     full rate — proratedAmount charged it at full rate;
 *   - a GROUP class bills a flat rate regardless of a few minutes over/under —
 *     proratedAmount prorated it by the minute.
 * So the admin headline overstated revenue and disagreed with what families were
 * actually billed. The fix prices each lesson with effectiveLessonAmount (the
 * same authoritative helper the invoice and student-invoice PDF use). This guards
 * the three pricing rules end-to-end through getRevenueReport.
 */
import { ReportsService } from '../src/reports/reports.service';

type Lesson = {
  duration: number;
  isTrialLesson: boolean | null;
  status: string;
  enrollment: { rate: number; defaultDuration: number; lessonType: string; trialRate: number | null };
};

function makeService(lessons: Lesson[]) {
  const db = {
    db: {
      query: {
        organizations: { findFirst: jest.fn().mockResolvedValue({ settings: { accountingMode: 'cash' } }) },
        lessons: { findMany: jest.fn().mockResolvedValue(lessons) },
      },
      // No ledger rows needed — we only assert earnedFromLessons here.
      select: jest.fn(() => ({
        from: () => ({ where: () => ({ groupBy: () => Promise.resolve([]) }) }),
      })),
    },
  };
  return new ReportsService(db as never);
}

const enr = (over: Partial<Lesson['enrollment']> = {}): Lesson['enrollment'] => ({
  rate: 4000, defaultDuration: 60, lessonType: 'private', trialRate: null, ...over,
});

describe('getRevenueReport — earnedFromLessons valuation', () => {
  it('prices a trial at its flat trialRate, not the full rate', async () => {
    const svc = makeService([
      { duration: 60, isTrialLesson: true, status: 'completed', enrollment: enr({ trialRate: 0 }) },
    ]);
    const res = await svc.getRevenueReport('org-1', '2026-07-01', '2026-07-31');
    // trialRate 0 → free trial, not the £40 rate proratedAmount would have counted.
    expect(res.earnedFromLessons).toBe(0);
    expect(res.completedLessons).toBe(1);
  });

  it('prices a group class flat, not prorated by the minute', async () => {
    const svc = makeService([
      // A 90-min group class at a £30 flat rate: flat £30, not 30 * 90/60 = £45.
      { duration: 90, isTrialLesson: false, status: 'completed', enrollment: enr({ lessonType: 'group', rate: 3000, defaultDuration: 60 }) },
    ]);
    const res = await svc.getRevenueReport('org-1', '2026-07-01', '2026-07-31');
    expect(res.earnedFromLessons).toBe(3000);
  });

  it('still prorates a private lesson against its default duration', async () => {
    const svc = makeService([
      // 30 min of a 60-min £40 private lesson → £20.
      { duration: 30, isTrialLesson: false, status: 'completed', enrollment: enr({ rate: 4000, defaultDuration: 60 }) },
    ]);
    const res = await svc.getRevenueReport('org-1', '2026-07-01', '2026-07-31');
    expect(res.earnedFromLessons).toBe(2000);
  });

  it('sums a mixed period the way the family was actually billed', async () => {
    const svc = makeService([
      { duration: 60, isTrialLesson: true, status: 'completed', enrollment: enr({ trialRate: 0 }) },            // 0
      { duration: 90, isTrialLesson: false, status: 'completed', enrollment: enr({ lessonType: 'group', rate: 3000 }) }, // 3000
      { duration: 60, isTrialLesson: false, status: 'cancelled_no_makeup', enrollment: enr({ rate: 4000 }) },   // 4000 (late cancel, family charged)
    ]);
    const res = await svc.getRevenueReport('org-1', '2026-07-01', '2026-07-31');
    // Raw proratedAmount would have counted 4000 + 4500 + 4000 = 12500.
    expect(res.earnedFromLessons).toBe(7000);
    expect(res.completedLessons).toBe(3);
  });
});
