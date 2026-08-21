'use client';

import { useState } from 'react';
import { useApi } from '@/lib/swr';
import { fmtTime, fmtTimeEnd, fmtDate, studioMinutesFromMidnight, studioDayString } from '@/lib/datetime';
import { PageHeader } from '@/components/page-header';
import { InfoTooltip } from '@/components/info-tooltip';
import { InstrumentIcon } from '@/components/instrument-icons';
import { Modal } from '@/components/modal';
import { CancelLessonModal } from '@/components/cancel-lesson-modal';
import { RescheduleLessonModal } from '@/components/reschedule-lesson-modal';
import { lessonStatusLabel } from '@/lib/lesson-status';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, CalendarClock, Check, X } from 'lucide-react';

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

// Only the landmark states — present (green) or absent/cancelled (red) — earn an
// icon; a lesson that's merely scheduled and hasn't happened yet shows none.
function attendanceIcon(status: string): { Icon: typeof Check; color: string; title: string } | null {
  if (status === 'completed') return { Icon: Check, color: '#22543D', title: 'Present' };
  if (status.startsWith('cancelled')) return { Icon: X, color: '#9B2C2C', title: 'Absent / cancelled' };
  return null;
}

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

// ─── Hour grid geometry ─────────────────────────────────────────────────────
// Matches the admin/teacher calendar's own PX_PER_HOUR (calendar/page.tsx) —
// this used to be 56, giving lesson blocks roughly half the vertical room and
// making the same lesson look cramped here versus roomy there.
const PX_PER_HOUR = 100;
const DAY_START = 8;   // 08:00
const DAY_END = 21;    // 21:00
const HOURS = Array.from({ length: DAY_END - DAY_START }, (_, i) => i + DAY_START);
const GRID_H = HOURS.length * PX_PER_HOUR;

interface Positioned { lesson: Lesson; top: number; height: number; col: number; cols: number; }

// Greedy interval-column packing, same idea as the staff calendar's day
// view — a family rarely has more than two lessons truly overlapping (e.g.
// siblings booked at the same time with different teachers), so no need for
// the staff calendar's row-wrapping fallback for a busy studio.
function layoutDay(dayLessons: Lesson[]): Positioned[] {
  const sorted = [...dayLessons].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const colEnds: number[] = [];
  const withCol = sorted.map((l) => {
    const start = new Date(l.startsAt).getTime();
    const end = start + l.duration * 60000;
    let col = colEnds.findIndex((e) => e <= start);
    if (col === -1) { col = colEnds.length; colEnds.push(end); } else { colEnds[col] = end; }
    return { lesson: l, col, start, end };
  });
  // Peak concurrent overlap determines how many columns to actually split
  // into — most lessons in a lightly-loaded family week never share a
  // column at all, so this rarely narrows further than full width.
  const cols = Math.max(1, colEnds.length);
  return withCol.map(({ lesson, col, start, end }) => {
    const startMin = studioMinutesFromMidnight(new Date(start).toISOString()) - DAY_START * 60;
    const endMin = studioMinutesFromMidnight(new Date(end).toISOString()) - DAY_START * 60;
    const top = Math.max(0, (startMin / 60) * PX_PER_HOUR);
    const height = Math.max(((endMin - startMin) / 60) * PX_PER_HOUR, 20);
    return { lesson, top, height, col, cols };
  });
}

function LessonDetailModal({ lesson, onClose, onReschedule, onCancel }: {
  lesson: Lesson | null; onClose: () => void;
  onReschedule: (id: string) => void; onCancel: (id: string, hoursUntil: number) => void;
}) {
  if (!lesson) return null;
  const cancelled = lesson.status.startsWith('cancelled');
  const hoursUntil = (new Date(lesson.startsAt).getTime() - Date.now()) / 3600000;
  const c = studentColor(lesson.student?.id);
  const instr = lesson.enrollment?.instrument;

  return (
    <Modal open={!!lesson} onClose={onClose} title="Lesson details">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-bold text-lg" style={{ color: c }}>
              {lesson.student?.firstName} {lesson.student?.lastName}
            </p>
            {instr && (
              <span className="flex items-center gap-1.5 mt-0.5 text-sm capitalize font-semibold" style={{ color: instrColor(instr) }}>
                <InstrumentIcon name={instr} size={13} /> {instr}
              </span>
            )}
          </div>
          {lesson.isTrialLesson && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--amber-lt)] text-[var(--amber)] font-semibold">Trial</span>
          )}
        </div>

        <div className="space-y-2 text-sm" style={{ color: 'var(--txt3)' }}>
          <p className="flex items-center gap-1.5">
            <CalendarIcon size={14} /> {fmtDate(lesson.startsAt, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <p className="flex items-center gap-1.5">
            <Clock size={14} /> {fmtTime(lesson.startsAt)}&ndash;{fmtTimeEnd(lesson.startsAt, lesson.duration)} ({lesson.duration} min)
          </p>
          <p>with {lesson.teacher ? `${lesson.teacher.firstName} ${lesson.teacher.lastName}` : 'no teacher assigned'}</p>
          {cancelled && <p style={{ color: 'var(--coral)' }}>{lessonStatusLabel(lesson.status)}</p>}
          {!cancelled && lesson.attendance && <p>Attendance: {lesson.attendance.status}</p>}
        </div>

        {!cancelled && hoursUntil > 0 && (
          <div className="flex gap-2 flex-wrap pt-1">
            {hoursUntil >= 24 && (
              <button
                onClick={() => onReschedule(lesson.id)}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl border font-medium hover:bg-[var(--surf)]"
                style={{ borderColor: 'var(--bd2)', color: 'var(--txt)' }}>
                <CalendarClock size={13} /> Request reschedule
              </button>
            )}
            <button
              onClick={() => onCancel(lesson.id, hoursUntil)}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl border font-medium hover:bg-[var(--coral-lt)]"
              style={{ borderColor: 'var(--bd2)', color: 'var(--coral)' }}>
              <X size={13} /> Cancel lesson
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * A real hour-grid weekly calendar for guardians/students, positioned by
 * actual lesson time (not just grouped per day) — clicking a lesson opens
 * its details, with reschedule/cancel actions where the lesson is still
 * eligible (mirrors the dashboard's "next lesson" card policy).
 */
export default function FamilySchedulePage() {
  const [anchor, setAnchor] = useState(() => new Date());
  const [selected, setSelected] = useState<Lesson | null>(null);
  const [reschedModal, setReschedModal] = useState<{ lessonId: string } | null>(null);
  const [cancelModal, setCancelModal] = useState<{ lessonId: string; hoursUntil: number } | null>(null);
  const weekStart = getWeekStart(anchor);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const from = studioDayString(weekStart);
  const to = studioDayString(weekEnd);
  const { data: lessonsRaw = [], isLoading, mutate } = useApi<Lesson[]>(`/family/lessons?from=${from}&to=${to}`);

  const todayStr = studioDayString(new Date());
  const weekLabel = `${formatDateLabel(weekStart, { day: 'numeric', month: 'short' })} – ${formatDateLabel(weekEnd, { day: 'numeric', month: 'short', year: 'numeric' })}`;

  function dayLessons(dayIndex: number): Lesson[] {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + dayIndex);
    const dayStr = studioDayString(d);
    return lessonsRaw.filter(l => studioDayString(l.startsAt) === dayStr);
  }

  return (
    <div>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Calendar
            <InfoTooltip text="Your family's lessons for the week, with each student's teacher. Click a lesson to see details, request a reschedule, or cancel it." />
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
        <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--bd)' }}>
          {/* Day header row */}
          <div className="grid" style={{ gridTemplateColumns: '48px repeat(7, 1fr)' }}>
            <div className="border-b border-r" style={{ borderColor: 'var(--bd)' }} />
            {DAYS.map((day, di) => {
              const d = new Date(weekStart);
              d.setDate(d.getDate() + di);
              const dStr = studioDayString(d);
              const isToday = dStr === todayStr;
              return (
                <div key={day} className="text-center py-2 border-b border-r last:border-r-0"
                  style={{ borderColor: 'var(--bd)', background: isToday ? 'var(--sage-lt)' : 'var(--surf)' }}>
                  <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: isToday ? 'var(--sage)' : 'var(--txt4)' }}>{day}</div>
                  <div className="text-lg font-bold" style={{ color: isToday ? 'var(--sage)' : 'var(--txt)' }}>{Number(dStr.slice(8, 10))}</div>
                </div>
              );
            })}
          </div>

          {/* Hour grid body */}
          <div className="grid overflow-x-auto" style={{ gridTemplateColumns: '48px repeat(7, minmax(110px, 1fr))' }}>
            {/* Hour labels */}
            <div className="relative border-r" style={{ borderColor: 'var(--bd)', height: GRID_H }}>
              {HOURS.map((h, i) => (
                <div key={h} className="absolute left-0 right-0 text-[10px] text-right pr-1.5 -translate-y-1/2"
                  style={{ top: i * PX_PER_HOUR, color: 'var(--txt4)' }}>
                  {h % 12 === 0 ? 12 : h % 12}{h < 12 ? 'am' : 'pm'}
                </div>
              ))}
            </div>

            {DAYS.map((day, di) => {
              const positioned = layoutDay(dayLessons(di));
              return (
                <div key={day} className="relative border-r last:border-r-0" style={{ borderColor: 'var(--bd)', height: GRID_H }}>
                  {HOURS.map((h, i) => (
                    <div key={h} className="absolute left-0 right-0 border-t"
                      style={{ top: i * PX_PER_HOUR, borderColor: 'var(--bd)', opacity: 0.6 }} />
                  ))}
                  {positioned.length === 0 && (
                    <p className="absolute inset-x-0 top-3 text-center text-[11px]" style={{ color: 'var(--txt4)' }}>—</p>
                  )}
                  {positioned.map(({ lesson: l, top, height, col, cols }) => {
                    const cancelled = l.status.startsWith('cancelled');
                    const c = studentColor(l.student?.id);
                    const present = attendanceIcon(l.status);
                    return (
                      <button
                        key={l.id}
                        onClick={() => setSelected(l)}
                        className="absolute rounded-lg text-left leading-tight overflow-hidden hover:brightness-95 transition flex items-stretch gap-0.5 px-1"
                        style={{
                          top, height, left: `${(col * 100) / cols}%`, width: `calc(${100 / cols}% - 3px)`,
                          background: hexToRgba(c, cancelled ? 0.06 : 0.14), border: `1px solid ${hexToRgba(c, cancelled ? 0.25 : 0.55)}`,
                          opacity: cancelled ? 0.6 : 1,
                        }}
                      >
                        {present && (
                          <span className="flex flex-col items-center justify-center shrink-0 w-3" title={present.title}>
                            <present.Icon size={10} style={{ color: present.color }} aria-label={present.title} />
                          </span>
                        )}
                        <span className="flex-1 min-w-0 flex flex-col justify-center gap-0.5 py-0.5">
                          <span className="flex items-baseline gap-1 min-w-0">
                            <span className="text-[10px] font-bold leading-none tabular-nums shrink-0" style={{ color: c, opacity: 0.7 }}>{fmtTime(l.startsAt)}</span>
                            <span className="text-[13px] font-bold leading-tight truncate" style={{ color: c, textDecoration: cancelled ? 'line-through' : undefined }}>
                              {l.student?.firstName} {l.student?.lastName}
                            </span>
                          </span>
                          <span className="flex items-center gap-1 min-w-0">
                            {l.enrollment?.instrument && (
                              <span className="text-[10px] capitalize font-semibold shrink-0 whitespace-nowrap" style={{ color: instrColor(l.enrollment.instrument) }}>
                                {l.enrollment.instrument}
                              </span>
                            )}
                            {l.teacher && (
                              <span className="text-[10px] leading-tight truncate min-w-0 flex-1" style={{ color: c, opacity: 0.7 }}>
                                · {l.teacher.firstName} {l.teacher.lastName}
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {lessonsRaw.length === 0 && !isLoading && (
        <div className="mt-4 flex items-center gap-2 text-sm" style={{ color: 'var(--txt4)' }}>
          <CalendarIcon size={14} /> No lessons scheduled this week.
        </div>
      )}

      <LessonDetailModal
        lesson={selected}
        onClose={() => setSelected(null)}
        onReschedule={(id) => { setSelected(null); setReschedModal({ lessonId: id }); }}
        onCancel={(id, hoursUntil) => { setSelected(null); setCancelModal({ lessonId: id, hoursUntil }); }}
      />
      <RescheduleLessonModal
        open={!!reschedModal} onClose={() => setReschedModal(null)}
        lessonId={reschedModal?.lessonId ?? null} onSent={() => {}}
      />
      <CancelLessonModal
        open={!!cancelModal} onClose={() => setCancelModal(null)}
        lessonId={cancelModal?.lessonId ?? null} hoursUntil={cancelModal?.hoursUntil ?? 0}
        onCancelled={() => mutate()}
      />
    </div>
  );
}
