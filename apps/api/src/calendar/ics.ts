/**
 * Minimal RFC 5545 iCalendar writer for lesson feeds.
 *
 * Deliberately hand-rolled rather than pulling a dependency: a feed only needs
 * VEVENTs with a stable UID, and the fiddly parts (escaping, 75-octet line
 * folding, UTC stamps) are a few lines each. Kept free of Nest/Drizzle so it
 * can be exercised directly.
 */

export interface IcsEvent {
  /** Stable across regenerations — this is what lets a calendar update rather than duplicate. */
  uid: string;
  start: Date;
  /** Minutes. */
  durationMinutes: number;
  summary: string;
  description?: string;
  location?: string;
  /** A cancelled lesson stays in the feed as CANCELLED so subscribers see it disappear. */
  cancelled?: boolean;
}

/** RFC 5545 §3.3.5 UTC form: 20260723T140000Z */
function toIcsUtc(d: Date): string {
  return `${d.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

/** RFC 5545 §3.3.11: backslash, semicolon, comma and newline are special in TEXT values. */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * RFC 5545 §3.1: content lines are folded at 75 octets, continuations starting
 * with a space. Folding counts bytes, not characters, so a multi-byte character
 * must not be split down the middle — hence the per-character byte accounting.
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = '';
  let currentBytes = 0;
  // Continuation lines carry a leading space, so they can hold one byte less.
  let limit = 75;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (currentBytes + size > limit) {
      out.push(current);
      current = '';
      currentBytes = 0;
      limit = 74;
    }
    current += char;
    currentBytes += size;
  }
  if (current) out.push(current);
  return out.join('\r\n ');
}

export function buildIcs(opts: {
  calendarName: string;
  events: IcsEvent[];
  /** Feed-level refresh hint. Calendar clients treat this as advisory at best. */
  refreshMinutes?: number;
}): string {
  const { calendarName, events, refreshMinutes = 60 } = opts;
  const stamp = toIcsUtc(new Date());

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Music & Life//Lesson Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    `NAME:${escapeText(calendarName)}`,
    `REFRESH-INTERVAL;VALUE=DURATION:PT${refreshMinutes}M`,
    `X-PUBLISHED-TTL:PT${refreshMinutes}M`,
  ];

  for (const e of events) {
    const end = new Date(e.start.getTime() + e.durationMinutes * 60000);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toIcsUtc(e.start)}`,
      `DTEND:${toIcsUtc(end)}`,
      `SUMMARY:${escapeText(e.summary)}`,
      ...(e.description ? [`DESCRIPTION:${escapeText(e.description)}`] : []),
      ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
      `STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
      // Lessons are a commitment, not a tentative hold.
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  // RFC 5545 requires CRLF line endings.
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
