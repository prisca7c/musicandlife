import { formatInZone, getOrgTimezone } from '../src/common/timezone';

// Regression for the BST bug: outbound emails/reports formatted lesson times
// with `toLocale*String` and no `timeZone`, so on the UTC API host (Render) a
// summer lesson rendered one hour early. formatInZone must pin the wall-clock to
// the studio zone regardless of the server's zone.
describe('formatInZone (studio-timezone rendering)', () => {
  // 16:00 London on a BST day is 15:00 UTC.
  const summerLesson = new Date('2026-07-13T15:00:00Z');
  // 16:00 London on a GMT day is 16:00 UTC.
  const winterLesson = new Date('2026-01-13T16:00:00Z');

  it('renders a BST lesson in studio wall-clock, not UTC', () => {
    expect(formatInZone(summerLesson, 'Europe/London', { hour: '2-digit', minute: '2-digit' })).toBe('16:00');
    // The old, buggy UTC rendering would have said 15:00.
    expect(formatInZone(summerLesson, 'UTC', { hour: '2-digit', minute: '2-digit' })).toBe('15:00');
  });

  it('is unchanged in winter (GMT == UTC), which is why the bug hid all winter', () => {
    expect(formatInZone(winterLesson, 'Europe/London', { hour: '2-digit', minute: '2-digit' })).toBe('16:00');
    expect(formatInZone(winterLesson, 'UTC', { hour: '2-digit', minute: '2-digit' })).toBe('16:00');
  });

  it('does not roll the date backwards for a late-evening BST lesson', () => {
    // 00:30 London on 14 Jul (BST) is 23:30 UTC on 13 Jul — a UTC render would
    // also show the wrong day, not just the wrong hour.
    const lateNight = new Date('2026-07-13T23:30:00Z');
    expect(formatInZone(lateNight, 'Europe/London', {})).toBe('14/07/2026');
    expect(formatInZone(lateNight, 'UTC', {})).toBe('13/07/2026');
  });
});

describe('getOrgTimezone', () => {
  const makeExec = (timezone: string | null | undefined) =>
    ({ query: { organizations: { findFirst: async () => (timezone === undefined ? undefined : { timezone }) } } }) as never;

  it("returns the org's configured timezone", async () => {
    expect(await getOrgTimezone(makeExec('Europe/London'), 'org-1')).toBe('Europe/London');
  });

  it('defaults to Europe/London when the org has no timezone set', async () => {
    expect(await getOrgTimezone(makeExec(null), 'org-1')).toBe('Europe/London');
  });

  it('defaults to Europe/London when the org is missing', async () => {
    expect(await getOrgTimezone(makeExec(undefined), 'org-1')).toBe('Europe/London');
  });
});
