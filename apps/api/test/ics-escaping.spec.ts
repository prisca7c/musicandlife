import { buildIcs } from '../src/calendar/ics';

// The public calendar feed is unauthenticated (token in the URL) and renders
// student / teacher / instrument / family names straight into iCal TEXT values.
// Those must be escaped per RFC 5545 §3.3.11 or a crafted name can break the
// feed or inject calendar properties.

function eventLines(ics: string): string[] {
  return ics.split('\r\n');
}

describe('buildIcs — RFC 5545 TEXT escaping', () => {
  it('escapes backslash, semicolon and comma', () => {
    const ics = buildIcs({
      calendarName: 'Cal',
      events: [{ uid: 'u1', start: new Date('2026-07-25T14:00:00Z'), durationMinutes: 30, summary: 'a\\b;c,d' }],
    });
    expect(ics).toContain('SUMMARY:a\\\\b\\;c\\,d');
  });

  it('collapses CRLF, lone LF and lone CR to the \\n escape (no raw line break injected)', () => {
    const ics = buildIcs({
      calendarName: 'Cal',
      // A bare \r in the middle is the dangerous case: a naive escaper that only
      // handles \r?\n leaves it raw, and some parsers treat it as a line break.
      events: [{ uid: 'u1', start: new Date('2026-07-25T14:00:00Z'), durationMinutes: 30, summary: 'Bob\rEND:VEVENT\rBEGIN:VEVENT' }],
    });
    // The injected value must be on a single SUMMARY line with escaped breaks.
    const summaryLines = eventLines(ics).filter(l => l.startsWith('SUMMARY:'));
    expect(summaryLines).toHaveLength(1);
    expect(summaryLines[0]).toBe('SUMMARY:Bob\\nEND:VEVENT\\nBEGIN:VEVENT');
    // Exactly one real VEVENT — no injected second event.
    expect(eventLines(ics).filter(l => l === 'BEGIN:VEVENT')).toHaveLength(1);
  });

  it('strips other C0 control characters', () => {
    const ics = buildIcs({
      calendarName: 'Cal',
      events: [{ uid: 'u1', start: new Date('2026-07-25T14:00:00Z'), durationMinutes: 30, summary: 'Piano\x00\x07 lesson' }],
    });
    const summary = eventLines(ics).find(l => l.startsWith('SUMMARY:'));
    expect(summary).toBe('SUMMARY:Piano lesson');
  });
});
