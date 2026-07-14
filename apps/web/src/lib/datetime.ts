// Studio-timezone date/time formatting.
//
// Lesson instants are stored in UTC. Every user of the studio should see times
// in the *studio's* timezone (e.g. a UK studio shows 16:00 whether the parent is
// in London or travelling abroad) — not in whatever zone their browser happens
// to be in. Formatting with `new Date(x).toLocaleTimeString()` uses the browser
// zone, which is the bug behind "I booked 4pm but it shows 12:00". These helpers
// pin every render to the studio zone.

export const STUDIO_TZ = process.env.NEXT_PUBLIC_STUDIO_TIMEZONE || 'Europe/London';

/** "16:00" in the studio zone. */
export function fmtTime(input: string | Date, tz: string = STUDIO_TZ): string {
  return new Date(input).toLocaleTimeString('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

/** End time = start + durationMinutes, formatted in the studio zone. */
export function fmtTimeEnd(input: string | Date, durationMinutes: number, tz: string = STUDIO_TZ): string {
  return fmtTime(new Date(new Date(input).getTime() + durationMinutes * 60000), tz);
}

/** "16:00 – 17:00" in the studio zone. */
export function fmtTimeRange(input: string | Date, durationMinutes: number, tz: string = STUDIO_TZ): string {
  return `${fmtTime(input, tz)} – ${fmtTimeEnd(input, durationMinutes, tz)}`;
}

/** Date formatted in the studio zone; pass Intl options to taste. */
export function fmtDate(
  input: string | Date,
  opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
  tz: string = STUDIO_TZ,
): string {
  return new Date(input).toLocaleDateString('en-GB', { timeZone: tz, ...opts });
}

/** Date + time in the studio zone, e.g. "13 Jul 2026, 16:00". */
export function fmtDateTime(input: string | Date, tz: string = STUDIO_TZ): string {
  return new Date(input).toLocaleString('en-GB', {
    timeZone: tz, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

/** The instant's wall-clock parts in the studio zone (for calendar grid math). */
function studioParts(input: string | Date, tz: string = STUDIO_TZ): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(input));
  const m: Record<string, number> = {};
  for (const p of parts) if (p.type !== 'literal') m[p.type] = parseInt(p.value, 10);
  if (m.hour === 24) m.hour = 0;
  return m;
}

/** Minutes since midnight in the studio zone (for positioning on a day grid). */
export function studioMinutesFromMidnight(input: string | Date, tz: string = STUDIO_TZ): number {
  const p = studioParts(input, tz);
  return p.hour! * 60 + p.minute!;
}

/** "YYYY-MM-DD" for the instant in the studio zone (for grouping lessons by day). */
export function studioDayString(input: string | Date, tz: string = STUDIO_TZ): string {
  const p = studioParts(input, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
