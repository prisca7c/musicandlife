'use client';

/**
 * Compact weekly availability visual — one row per weekday, coloured segments
 * showing the hours a teacher is free. Used on the family dashboard (their
 * teachers' hours) and the teacher dashboard (their own). Keeps the same
 * "shaded = available" language as the main calendar, at a glance.
 */

export interface AvailWindow {
  weekday: string; startTime: string; endTime: string;
  staffId?: string; teacherName?: string;
}

const DAYS: [string, string][] = [
  ['monday', 'Mon'], ['tuesday', 'Tue'], ['wednesday', 'Wed'],
  ['thursday', 'Thu'], ['friday', 'Fri'], ['saturday', 'Sat'], ['sunday', 'Sun'],
];
const START_H = 8;
const END_H = 21;
const SPAN = (END_H - START_H) * 60;
const HOUR_TICKS = [8, 10, 12, 14, 16, 18, 20];

const PALETTE = ['#2B6CB0', '#B7791F', '#553C9A', '#276749', '#C05621', '#97266D', '#2C7A7B', '#9B2C2C'];

function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
function pct(min: number): number {
  return Math.min(Math.max((min - START_H * 60) / SPAN * 100, 0), 100);
}

export function AvailabilityWeekGrid({ windows }: { windows: AvailWindow[] }) {
  const teacherIds = [...new Set(windows.map(w => w.staffId).filter((v): v is string => !!v))];
  const colorFor = (id?: string) => id ? PALETTE[teacherIds.indexOf(id) % PALETTE.length]! : '#3D7A55';
  const nameFor = (id: string) => windows.find(w => w.staffId === id)?.teacherName ?? 'Teacher';
  const showLegend = teacherIds.length > 1;

  if (windows.length === 0) {
    return <p className="text-sm text-center py-4" style={{ color: 'var(--txt4)' }}>No availability set yet.</p>;
  }

  return (
    <div>
      {/* Hour axis */}
      <div className="relative h-4 ml-9 mb-1">
        {HOUR_TICKS.map(h => (
          <span key={h} className="absolute text-[9px] font-semibold -translate-x-1/2 tabular-nums"
            style={{ left: `${pct(h * 60)}%`, color: 'var(--txt4)' }}>
            {h}:00
          </span>
        ))}
      </div>

      <div className="space-y-1">
        {DAYS.map(([key, label]) => {
          const dayWins = windows.filter(w => w.weekday === key);
          return (
            <div key={key} className="flex items-center gap-2">
              <span className="w-7 text-[10px] font-bold uppercase tracking-wide shrink-0" style={{ color: 'var(--txt3)' }}>
                {label}
              </span>
              <div className="relative flex-1 h-5 rounded-md overflow-hidden" style={{ background: 'var(--surf)' }}>
                {/* hour gridlines */}
                {HOUR_TICKS.map(h => (
                  <div key={h} className="absolute top-0 bottom-0 w-px" style={{ left: `${pct(h * 60)}%`, background: 'var(--bd)' }} />
                ))}
                {/* availability segments */}
                {dayWins.map((w, i) => {
                  const left = pct(toMin(w.startTime));
                  const width = pct(toMin(w.endTime)) - left;
                  if (width <= 0) return null;
                  const c = colorFor(w.staffId);
                  return (
                    <div key={i} className="absolute top-0.5 bottom-0.5 rounded-[4px]"
                      title={`${w.teacherName ?? 'Available'} · ${w.startTime}–${w.endTime}`}
                      style={{ left: `${left}%`, width: `${width}%`, background: c, opacity: 0.85 }} />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {showLegend && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3">
          {teacherIds.map(id => (
            <span key={id} className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: colorFor(id) }}>
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: colorFor(id) }} />
              {nameFor(id)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
