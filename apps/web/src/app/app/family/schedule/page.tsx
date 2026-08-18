'use client';

import { useState } from 'react';
import { useApi } from '@/lib/swr';
import { fmtTime, studioDayString } from '@/lib/datetime';
import { PageHeader } from '@/components/page-header';
import { InfoTooltip } from '@/components/info-tooltip';
import { InstrumentIcon } from '@/components/instrument-icons';
import { lessonStatusLabel } from '@/lib/lesson-status';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';

interface Lesson {
  id: string; startsAt: string; duration: number; status: string; isTrialLesson: boolean;
  student: { id: string; firstName: string; lastName: string } | null;
  teacher: { id: string; firstName: string; lastName: string } | null;
  enrollment: { instrument: string; lessonType: string } | null;
  attendance: { status: string } | null;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const INSTR_HUE: Record<string, string> = {
  piano: '#3D7A55', violin: '#2B6CB0', guitar: '#B7791F', drums: '#C05621',
  cello: '#553C9A', viola: '#2C7A7B', 'bass guitar': '#276749', vocal: '#97266D',
  ukulele: '#D69E2E', 'susuki violin': '#2B6CB0', ensemble: '#718096',
};
function instrColor(name?: string | null) { return INSTR_HUE[(name ?? '').toLowerCase()] ?? '#4A5568'; }

// Deterministic per-student colour so a family with several kids can tell
// whose lesson is whose at a glance without a legend.
const STUDENT_PALETTE = ['#2B6CB0', '#B7791F', '#553C9A', '#276749', '#C05621', '#97266D'];
function studentColor(id?: string | null) {
  if (!id) return '#4A5568';
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return STUDENT_PALETTE[hash % STUDENT_PALETTE.length]!;
}

function getWeekStart(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function formatDateLabel(d: Date, opts: Intl.DateTimeFormatOptions) {
  return new Date(`${studioDayString(d)}T12:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
}

/**
 * A read-only weekly calendar for guardians/students — their own children's
 * lessons and who's teaching them, grouped by day. Deliberately simpler than
 * the staff calendar (no hour grid, no editing): a family's own lesson count
 * is small enough that a plain per-day list reads better than a dense pixel
 * grid, and there's nothing here for a parent or student to click into edit.
 */
export default function FamilySchedulePage() {
  const [anchor, setAnchor] = useState(() => new Date());
  const weekStart = getWeekStart(anchor);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const from = studioDayString(weekStart);
  const to = studioDayString(weekEnd);
  const { data: lessonsRaw = [], isLoading } = useApi<Lesson[]>(`/family/lessons?from=${from}&to=${to}`);

  const todayStr = studioDayString(new Date());
  const weekLabel = `${formatDateLabel(weekStart, { day: 'numeric', month: 'short' })} – ${formatDateLabel(weekEnd, { day: 'numeric', month: 'short', year: 'numeric' })}`;

  function dayLessons(dayIndex: number): Lesson[] {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + dayIndex);
    const dayStr = studioDayString(d);
    return lessonsRaw
      .filter(l => studioDayString(l.startsAt) === dayStr)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }

  return (
    <div>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Calendar
            <InfoTooltip text="Your family's lessons for the week, with each student's teacher. Cancelled lessons show struck through." />
          </span>
        }
        subtitle="Your lessons and teachers, week by week"
      />

      <div className="flex items-center gap-2 mb-5">
        <button onClick={() => { const d = new Date(anchor); d.setDate(d.getDate() - 7); setAnchor(d); }}
          className="ui-btn-ghost px-2.5 py-1.5" aria-label="Previous week">
          <ChevronLeft size={16} />
        </button>
        <button onClick={() => setAnchor(new Date())} className="ui-btn-ghost text-sm px-3 py-1.5">
          This week
        </button>
        <button onClick={() => { const d = new Date(anchor); d.setDate(d.getDate() + 7); setAnchor(d); }}
          className="ui-btn-ghost px-2.5 py-1.5" aria-label="Next week">
          <ChevronRight size={16} />
        </button>
        <span className="text-sm font-semibold ml-2" style={{ color: 'var(--txt2)' }}>{weekLabel}</span>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-2xl border border-[var(--bd)] py-16 text-center text-sm" style={{ color: 'var(--txt4)' }}>
          Loading…
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
          {DAYS.map((day, di) => {
            const d = new Date(weekStart);
            d.setDate(d.getDate() + di);
            const dStr = studioDayString(d);
            const isToday = dStr === todayStr;
            const dayList = dayLessons(di);
            return (
              <div key={day} className="bg-white rounded-2xl border overflow-hidden flex flex-col"
                style={{ borderColor: isToday ? 'var(--sage)' : 'var(--bd)', borderWidth: isToday ? 1.5 : 1 }}>
                <div className="px-3 py-2 text-center border-b" style={{ borderColor: 'var(--bd)', background: isToday ? 'var(--sage-lt)' : 'var(--surf)' }}>
                  <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: isToday ? 'var(--sage)' : 'var(--txt4)' }}>{day}</div>
                  <div className="text-lg font-bold" style={{ color: isToday ? 'var(--sage)' : 'var(--txt)' }}>{Number(dStr.slice(8, 10))}</div>
                </div>
                <div className="p-2 space-y-1.5 flex-1 min-h-[80px]">
                  {dayList.length === 0 ? (
                    <p className="text-center text-[11px] py-4" style={{ color: 'var(--txt4)' }}>No lessons</p>
                  ) : dayList.map(l => {
                    const cancelled = l.status.startsWith('cancelled');
                    const c = studentColor(l.student?.id);
                    const instr = l.enrollment?.instrument;
                    return (
                      <div key={l.id} className="rounded-lg px-2 py-1.5 text-xs"
                        style={{ background: hexToRgba(c, cancelled ? 0.06 : 0.12), border: `1px solid ${hexToRgba(c, cancelled ? 0.25 : 0.5)}`, opacity: cancelled ? 0.65 : 1 }}>
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-bold tabular-nums" style={{ color: c, opacity: 0.75 }}>{fmtTime(l.startsAt)}</span>
                          {l.isTrialLesson && <span className="text-[9px] px-1 rounded bg-[var(--amber-lt)] text-[var(--amber)] font-semibold">trial</span>}
                        </div>
                        <p className="font-bold truncate" style={{ color: c, textDecoration: cancelled ? 'line-through' : undefined }}>
                          {l.student?.firstName} {l.student?.lastName}
                        </p>
                        {instr && (
                          <span className="flex items-center gap-1 truncate" style={{ color: instrColor(instr) }}>
                            <InstrumentIcon name={instr} size={10} />
                            <span className="capitalize font-semibold">{instr}</span>
                          </span>
                        )}
                        <p className="truncate" style={{ color: c, opacity: 0.7 }}>
                          {l.teacher ? `${l.teacher.firstName} ${l.teacher.lastName}` : 'No teacher assigned'}
                        </p>
                        {cancelled && (
                          <p className="text-[10px] mt-0.5" style={{ color: 'var(--txt4)' }}>{lessonStatusLabel(l.status)}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {lessonsRaw.length === 0 && !isLoading && (
        <div className="mt-4 flex items-center gap-2 text-sm" style={{ color: 'var(--txt4)' }}>
          <CalendarIcon size={14} /> No lessons scheduled this week.
        </div>
      )}
    </div>
  );
}
