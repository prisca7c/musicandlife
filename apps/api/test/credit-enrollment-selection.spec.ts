import { pickCreditForEnrollment } from '../src/attendance/attendance.service';

/**
 * Prepaid credits are minted per enrolment and banked at that enrolment's rate
 * (see planPrepaidCredits): the exact pence come off the family balance when the
 * credit is bought. So consuming a credit bought for one enrolment to cover a
 * lesson on another (at a different rate) mis-bills the family. A lesson must
 * spend a credit for its own enrolment, or a generic (enrolment-less) credit,
 * and never one bought for a different enrolment.
 */
const credit = (id: string, enrollmentId: string | null, createdAtIso: string) =>
  ({ id, enrollmentId, createdAt: new Date(createdAtIso) });

describe('pickCreditForEnrollment', () => {
  it('prefers a credit bought for the lesson’s own enrolment', () => {
    const picked = pickCreditForEnrollment(
      [credit('violin-1', 'enr-violin', '2026-01-01'), credit('piano-1', 'enr-piano', '2026-01-02')],
      'enr-piano',
    );
    expect(picked?.id).toBe('piano-1');
  });

  it('never spends a credit bought for a different enrolment', () => {
    // Only a violin credit exists; a piano lesson must NOT consume it.
    const picked = pickCreditForEnrollment([credit('violin-1', 'enr-violin', '2026-01-01')], 'enr-piano');
    expect(picked).toBeNull();
  });

  it('falls back to a generic (enrolment-less) credit when no own-enrolment credit exists', () => {
    const picked = pickCreditForEnrollment(
      [credit('violin-1', 'enr-violin', '2026-01-01'), credit('manual-1', null, '2026-01-03')],
      'enr-piano',
    );
    expect(picked?.id).toBe('manual-1');
  });

  it('prefers an own-enrolment credit over an older generic one', () => {
    const picked = pickCreditForEnrollment(
      [credit('manual-1', null, '2026-01-01'), credit('piano-1', 'enr-piano', '2026-01-05')],
      'enr-piano',
    );
    expect(picked?.id).toBe('piano-1');
  });

  it('consumes the oldest matching credit first', () => {
    const picked = pickCreditForEnrollment(
      [credit('piano-new', 'enr-piano', '2026-02-01'), credit('piano-old', 'enr-piano', '2026-01-01')],
      'enr-piano',
    );
    expect(picked?.id).toBe('piano-old');
  });

  it('returns null when there are no available credits', () => {
    expect(pickCreditForEnrollment([], 'enr-piano')).toBeNull();
  });

  it('matches generic credits when the lesson itself has no enrolment', () => {
    const picked = pickCreditForEnrollment([credit('manual-1', null, '2026-01-01')], null);
    expect(picked?.id).toBe('manual-1');
  });
});
