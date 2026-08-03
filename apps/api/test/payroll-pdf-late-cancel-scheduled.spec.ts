/**
 * Payroll PDF must value each lesson exactly as the payroll RUN pays it.
 *
 * The run (computeRunItems) uses actual elapsed time ONLY for a completed
 * lesson; a late cancellation (cancelled_no_makeup) is always paid at the
 * scheduled duration because the lesson never happened. The downloadable payroll
 * PDF applied the actual-elapsed override to BOTH statuses, so a late-cancelled
 * lesson that still carried actualStartedAt/EndedAt — which a mis-mark correction
 * (present → absent_no_makeup) leaves behind — was valued differently in the PDF
 * than the run actually pays. This guards the PDF against that divergence.
 */
import { ReportsService } from '../src/reports/reports.service';

type Att = { status: string; actualStartedAt: Date | null; actualEndedAt: Date | null } | null;
type Lesson = { id: string; status: string; duration: number; startsAt: Date; attendance: Att };

function makeService(hourlyRate: number, periodLessons: Lesson[]) {
  const db = {
    db: {
      query: {
        staffMembers: { findFirst: jest.fn().mockResolvedValue({ id: 'staff-1', firstName: 'Jo', lastName: 'Bell', hourlyRate }) },
        organizations: { findFirst: jest.fn().mockResolvedValue({ name: 'Music & Life', settings: {} }) },
        lessons: {
          findMany: jest.fn().mockResolvedValue(
            periodLessons.map(l => ({ ...l, student: { firstName: 'A', lastName: 'B' }, enrollment: { instrument: 'Piano' } })),
          ),
        },
      },
    },
  };
  return new ReportsService(db as never);
}

const HOURLY = 6000; // £60/hr

describe('getTeacherPayrollPdfData — late-cancel paid at scheduled duration', () => {
  it('pays a late cancellation at scheduled duration, ignoring stale actual times', async () => {
    const svc = makeService(HOURLY, [
      {
        id: 'l-latecancel', status: 'cancelled_no_makeup', duration: 60, startsAt: new Date('2026-07-10T10:00:00Z'),
        // Left over from a 'present' mark before the correction to late-cancel:
        // 50 real minutes recorded. The run ignores these for a cancellation.
        attendance: { status: 'absent_no_makeup', actualStartedAt: new Date('2026-07-10T10:00:00Z'), actualEndedAt: new Date('2026-07-10T10:50:00Z') },
      },
    ]);
    const data = await svc.getTeacherPayrollPdfData('org-1', 'staff-1', '2026-07-01', '2026-07-31');
    // Scheduled 60 min at £60/hr = £60, NOT the 50-min actual (£50).
    expect(data.rows[0]!.minutes).toBe(60);
    expect(data.rows[0]!.amount).toBe(6000);
    expect(data.gross).toBe(6000);
  });

  it('still uses actual elapsed time for a completed lesson', async () => {
    const svc = makeService(HOURLY, [
      {
        id: 'l-completed', status: 'completed', duration: 60, startsAt: new Date('2026-07-11T10:00:00Z'),
        // Ran 15 min long.
        attendance: { status: 'present', actualStartedAt: new Date('2026-07-11T10:00:00Z'), actualEndedAt: new Date('2026-07-11T11:15:00Z') },
      },
    ]);
    const data = await svc.getTeacherPayrollPdfData('org-1', 'staff-1', '2026-07-01', '2026-07-31');
    expect(data.rows[0]!.minutes).toBe(75);
    expect(data.rows[0]!.amount).toBe(7500);
  });

  it('falls back to scheduled duration for a completed lesson with no actual times', async () => {
    const svc = makeService(HOURLY, [
      { id: 'l-plain', status: 'completed', duration: 30, startsAt: new Date('2026-07-12T10:00:00Z'), attendance: { status: 'present', actualStartedAt: null, actualEndedAt: null } },
    ]);
    const data = await svc.getTeacherPayrollPdfData('org-1', 'staff-1', '2026-07-01', '2026-07-31');
    expect(data.rows[0]!.minutes).toBe(30);
    expect(data.rows[0]!.amount).toBe(3000);
  });
});
