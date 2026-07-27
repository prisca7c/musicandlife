/**
 * Timezone helpers for interpreting user-supplied lesson times.
 *
 * The studio operates in one IANA timezone (e.g. Europe/London). When a user
 * picks "16:00" in the UI that's a *wall-clock* time in the studio's zone — not
 * UTC and not the server's local zone. The naive datetime string the browser
 * sends ("2026-07-13T16:00:00") has no offset, so `new Date(str)` would wrongly
 * interpret it in the server's local zone (UTC on Render). These helpers convert
 * such a wall-clock string into the correct absolute instant for the studio zone.
 */

/** Offset (ms) of `timeZone` at the given absolute instant. Positive = ahead of UTC. */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const m: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') m[p.type] = p.value;
  let hour = parseInt(m.hour!, 10);
  if (hour === 24) hour = 0; // some engines render midnight as 24
  const asUTC = Date.UTC(+m.year!, +m.month! - 1, +m.day!, hour, +m.minute!, +m.second!);
  return asUTC - instant.getTime();
}

// A trailing Z or ±hh:mm / ±hhmm means the string already carries a zone.
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * Parse a datetime string into the correct UTC instant.
 * - If it already carries a zone (Z or ±hh:mm), it's parsed as-is.
 * - If it's a *naive* wall-clock string (YYYY-MM-DDThh:mm[:ss]), it's interpreted
 *   in `timeZone` (the studio's zone) rather than the server's local zone.
 */
export function parseZonedDateTime(input: string, timeZone: string): Date {
  const s = input.trim();
  if (HAS_ZONE.test(s)) return new Date(s);

  const [datePart, timePart = '00:00'] = s.split('T');
  const [y, mo, d] = datePart!.split('-').map(Number);
  const [h, mi, sec] = timePart.split(':').map(Number);

  // Best UTC guess treating the wall-clock as if it were UTC, then subtract the
  // zone's offset. A second pass pins down DST-boundary cases where the offset
  // at the guess differs from the offset at the resolved local time.
  const guess = Date.UTC(y!, (mo || 1) - 1, d!, h || 0, mi || 0, sec || 0);
  let instant = new Date(guess - tzOffsetMs(new Date(guess), timeZone));
  instant = new Date(guess - tzOffsetMs(instant, timeZone));
  return instant;
}

const WEEKDAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'] as const;
export type Weekday = typeof WEEKDAY_NAMES[number];

/**
 * The inverse of {@link parseZonedDateTime} for a recurring rule: given an
 * absolute instant, return the weekday + wall-clock "HH:MM" it falls on IN THE
 * STUDIO'S ZONE. A slot the family picked as "Wed 15:30 London" must recur on
 * Wednesdays at 15:30 local — deriving that from the server's zone (UTC on
 * Render) would drift by the offset and land the series on the wrong day/time
 * around DST. Uses the same Intl-in-zone approach as {@link parseZonedDateTime}.
 */
export function zonedWeekdayAndTime(instant: Date, timeZone: string): { weekday: Weekday; startTime: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, weekday: 'long', hour: '2-digit', minute: '2-digit',
  }).formatToParts(instant);
  const m: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') m[p.type] = p.value;
  let hour = parseInt(m.hour!, 10);
  if (hour === 24) hour = 0;
  return {
    weekday: (m.weekday ?? '').toLowerCase() as Weekday,
    startTime: `${String(hour).padStart(2, '0')}:${m.minute}`,
  };
}
