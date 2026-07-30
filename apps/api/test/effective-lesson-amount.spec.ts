/**
 * effectiveLessonAmount centralises the three lesson-pricing rules so the
 * invoice line, the attendance charge, and the pay-now preview never diverge:
 *  - a trial with a flat trialRate is a fixed intro price (no proration, and it
 *    beats the group rule);
 *  - a group class is a flat set price;
 *  - a private lesson is prorated against its default duration.
 */
import { effectiveLessonAmount } from '../src/billing/billing.service';

describe('effectiveLessonAmount', () => {
  it('prorates a private lesson against its default duration', () => {
    expect(effectiveLessonAmount({ lessonType: 'private', rate: 6000, defaultDuration: 60, duration: 30 })).toBe(3000);
    expect(effectiveLessonAmount({ lessonType: 'private', rate: 6000, defaultDuration: 60, duration: 60 })).toBe(6000);
  });

  it('charges a group class its flat rate regardless of length', () => {
    expect(effectiveLessonAmount({ lessonType: 'group', rate: 2000, defaultDuration: 60, duration: 75 })).toBe(2000);
  });

  it('uses the flat trial rate for a trial lesson when one is set', () => {
    expect(effectiveLessonAmount({ isTrialLesson: true, lessonType: 'private', rate: 6000, trialRate: 2000, defaultDuration: 60, duration: 30 })).toBe(2000);
  });

  it('a trial rate overrides even the group flat rate', () => {
    expect(effectiveLessonAmount({ isTrialLesson: true, lessonType: 'group', rate: 2000, trialRate: 1000, defaultDuration: 60, duration: 60 })).toBe(1000);
  });

  it('falls back to the normal rate for a trial with no trial rate set', () => {
    expect(effectiveLessonAmount({ isTrialLesson: true, lessonType: 'private', rate: 6000, trialRate: null, defaultDuration: 60, duration: 60 })).toBe(6000);
  });

  it('treats a zero trial rate as a real (free) price, not "unset"', () => {
    expect(effectiveLessonAmount({ isTrialLesson: true, lessonType: 'private', rate: 6000, trialRate: 0, defaultDuration: 60, duration: 60 })).toBe(0);
  });

  it('ignores the trial rate when the lesson is not a trial', () => {
    expect(effectiveLessonAmount({ isTrialLesson: false, lessonType: 'private', rate: 6000, trialRate: 2000, defaultDuration: 60, duration: 60 })).toBe(6000);
  });
});
