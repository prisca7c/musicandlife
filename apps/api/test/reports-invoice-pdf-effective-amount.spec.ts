import { ReportsService } from '../src/reports/reports.service';

// The student-invoice PDF is a family-facing money document and must price each
// lesson exactly as the authoritative invoice/attendance charge does
// (billing.effectiveLessonAmount): a TRIAL bills its flat trialRate, a GROUP
// class its flat rate, a PRIVATE lesson prorated. It previously used raw
// proratedAmount, so trials were priced at the full rate and group classes were
// prorated by the minute — the PDF disagreed with the family's actual balance.

const ORG = { id: 'org-1', name: 'Music & Life' };
const STUDENT = {
  id: 'stu-1', firstName: 'Ada', lastName: 'Lovelace',
  family: { id: 'fam-1', name: 'Lovelace', email: 'a@x.com', address: null },
};

function makeService(periodLessons: unknown[]) {
  const db = {
    db: {
      query: {
        students: { findFirst: jest.fn().mockResolvedValue(STUDENT) },
        organizations: { findFirst: jest.fn().mockResolvedValue({ id: ORG.id, name: ORG.name, timezone: 'Europe/London' }) },
        lessons: { findMany: jest.fn().mockResolvedValue(periodLessons) },
        lessonCredits: { findMany: jest.fn().mockResolvedValue([]) },
      },
    },
  };
  return new ReportsService(db as never);
}

const at = new Date('2026-08-10T15:00:00Z');

describe('ReportsService.getStudentInvoicePdfData — effectiveLessonAmount pricing', () => {
  it('prices a trial lesson at its flat trialRate, not the full rate', async () => {
    const svc = makeService([
      { id: 'l1', startsAt: at, duration: 30, status: 'completed', isTrialLesson: true,
        enrollment: { instrument: 'Piano', rate: 3000, defaultDuration: 60, lessonType: 'private', trialRate: 1000 } },
    ]);
    const data = await svc.getStudentInvoicePdfData('org-1', 'stu-1', '2026-08-01', '2026-08-31');
    // Old bug: proratedAmount(3000, 60, 30) = 1500. Correct trial price = trialRate = 1000.
    expect(data.lineItems[0]!.amount).toBe(1000);
    expect(data.total).toBe(1000);
  });

  it('bills a group class flat regardless of a shorter duration', async () => {
    const svc = makeService([
      { id: 'l2', startsAt: at, duration: 45, status: 'completed', isTrialLesson: false,
        enrollment: { instrument: 'Choir', rate: 2000, defaultDuration: 60, lessonType: 'group', trialRate: null } },
    ]);
    const data = await svc.getStudentInvoicePdfData('org-1', 'stu-1', '2026-08-01', '2026-08-31');
    // Old bug: proratedAmount(2000, 60, 45) = 1500. Group is flat = rate = 2000.
    expect(data.lineItems[0]!.amount).toBe(2000);
  });

  it('still prorates a private lesson of non-default length', async () => {
    const svc = makeService([
      { id: 'l3', startsAt: at, duration: 30, status: 'completed', isTrialLesson: false,
        enrollment: { instrument: 'Violin', rate: 3000, defaultDuration: 60, lessonType: 'private', trialRate: null } },
    ]);
    const data = await svc.getStudentInvoicePdfData('org-1', 'stu-1', '2026-08-01', '2026-08-31');
    expect(data.lineItems[0]!.amount).toBe(1500);
  });
});
