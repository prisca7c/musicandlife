'use client';

import { useState, useEffect, useRef, FormEvent } from 'react';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { fmtTime, fmtTimeEnd, fmtDate, studioMinutesFromMidnight, studioDayString } from '@/lib/datetime';
import { lessonStatusLabel, attendanceStatusLabel } from '@/lib/lesson-status';
import { useRole } from '@/lib/use-role';
import { Modal } from '@/components/modal';
import { Badge } from '@/components/badge';
import { SearchableSelect } from '@/components/searchable-select';
import { InstrumentIcon } from '@/components/instrument-icons';
import { InfoTooltip } from '@/components/info-tooltip';
import { AddStudentModal } from '@/components/add-student-modal';
import { AssignStudentsModal } from '@/components/assign-students-modal';
import { PRIVATE_INSTRUMENTS, GROUP_INSTRUMENTS, lessonRate } from '@music-life/types';
import { ChevronDown, ChevronLeft, ChevronRight, UserPlus, Users, Check, X, Repeat, PoundSterling, Shuffle } from 'lucide-react';

interface Lesson {
  id: string; startsAt: string; duration: number; status: string; notes: string | null;
  student: { id: string; firstName: string; lastName: string } | null;
  teacher: { id: string; firstName: string; lastName: string } | null;
  attendance: { status: string } | null;
  enrollment: { instrument: string; lessonType: string; groupName?: string | null; teacherId?: string | null } | null;
  paymentStatus?: 'paid' | 'unpaid' | 'void' | 'unbilled';
}
interface StaffMember { id: string; firstName: string; lastName: string; }
interface Student { id: string; firstName: string; lastName: string; }
interface Enrollment {
  id: string; instrument: string; lessonType: string; groupName?: string | null; status: string;
  teacherId?: string | null; rate?: number; defaultDuration?: number;
}
interface StudentDetail { id: string; enrollments: Enrollment[]; }
interface Availability { id: string; staffId: string; weekday: string; startTime: string; endTime: string; }

// ─── Layout constants ─────────────────────────────────────────────────────────
const PX_PER_HOUR = 88;          // pixel height per 1 hour band
const DAY_START   = 8;           // 08:00
const DAY_END     = 21;          // 21:00
const HOURS       = Array.from({ length: DAY_END - DAY_START }, (_, i) => i + DAY_START);
const DAYS        = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const TOTAL_H     = HOURS.length * PX_PER_HOUR; // 1144px

// ─── Availability band geometry (windows are studio wall-clock "HH:MM") ─────────
function hhmmToMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
/** Pixel top/height for a window, clamped to the visible DAY_START..DAY_END range. */
function bandBox(startMin: number, endMin: number): { top: number; height: number } | null {
  const top = Math.max((startMin - DAY_START * 60) / 60 * PX_PER_HOUR, 0);
  const bottom = Math.min((endMin - DAY_START * 60) / 60 * PX_PER_HOUR, TOTAL_H);
  if (bottom <= top) return null;
  return { top, height: bottom - top };
}
/** Merge overlapping windows into a flat set of [start,end] minute ranges (for the week view union). */
function mergeWindows(wins: Availability[]): [number, number][] {
  const iv = wins.map(w => [hhmmToMin(w.startTime), hhmmToMin(w.endTime)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of iv) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getRoleFromToken(token?: string): string {
  try {
    if (!token) return '';
    const payload = JSON.parse(atob(token.split('.')[1]!));
    return payload.role ?? '';
  } catch { return ''; }
}

function getWeekStart(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}
// The calendar's from/to/weekStart fetch bounds, as the STUDIO-zone day of a
// local-midnight grid date. `.toISOString()` renders in UTC, which under BST
// (local = UTC+1) rolls a local Monday back to Sunday — so the API window
// started a day early and its upper bound cut off the grid's final Sunday,
// hiding every Sunday lesson from the week view (and the last Sunday of the
// month view) all summer. studioDayString matches how the grid buckets lessons.
function formatDate(d: Date) { return studioDayString(d); }

// Render a Date for display using the STUDIO-zone calendar day, not the
// browser's. `d.toLocaleDateString(...)` with no `timeZone` reads the day/
// weekday out of the browser's local clock — for a viewer whose device isn't
// set to the studio's zone, near a day boundary that can read a different
// weekday (or day-of-month) than what studioDayString buckets the grid's
// lessons/availability bands by, e.g. a "Sat" header sitting over Sunday's
// data. Anchoring at noon UTC of the studio-zone day string (the same
// technique the backend uses to turn a date into a weekday) makes the label
// zone-independent and always agree with the grid underneath it.
function formatDateLabel(d: Date, opts: Intl.DateTimeFormatOptions) {
  return new Date(`${studioDayString(d)}T12:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
}

// The 6-week (42-day) grid that renders the month containing `date`: always
// starts on the Monday on or before the 1st, so the first week's leading days
// from the previous month fill in, and covers 42 days so any month fits.
function getMonthGrid(date: Date): { monthStart: Date; gridStart: Date; gridEnd: Date } {
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
  const gridStart = getWeekStart(monthStart);
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridEnd.getDate() + 41);
  return { monthStart, gridStart, gridEnd };
}

// Position on the day grid using the lesson's wall-clock time in the studio zone
// (so a 16:00 lesson sits at the 16:00 row for every viewer, not the browser's zone).
function minutesFromDayStart(iso: string): number {
  return studioMinutesFromMidnight(iso) - DAY_START * 60;
}

// ─── Overlap-aware stacked layout ──────────────────────────────────────────────
// Overlapping lessons used to be split into narrow side-by-side columns, which
// made the box too small to read with more than two or three at once. Instead,
// every block keeps full width and overlapping lessons stack top-to-bottom,
// ordered chronologically (then alphabetically by student for exact ties) —
// same ordering `sorted` below already produces, so a cluster's array order
// *is* its stack order.
const STACK_ROW_H = 34; // px per row once a slot is stacked — enough for time + student name to stay legible

type LessonLayout = Lesson & { stackIndex: number; stackSize: number; clusterStart: string };

function computeLayout(dayLessons: Lesson[]): LessonLayout[] {
  const sorted = [...dayLessons].sort((a, b) => {
    const byTime = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
    if (byTime !== 0) return byTime;
    const aName = `${a.student?.firstName ?? ''} ${a.student?.lastName ?? ''}`;
    const bName = `${b.student?.firstName ?? ''} ${b.student?.lastName ?? ''}`;
    return aName.localeCompare(bName);
  });

  // Split into clusters of transitively-overlapping lessons — a sweep that
  // starts a new cluster whenever a gap opens up. A lesson linked into a
  // busier cluster through an intermediate lesson it doesn't itself overlap
  // still belongs in that cluster, so the whole group stacks together.
  const clusters: Lesson[][] = [];
  let current: Lesson[] = [];
  let clusterEnd = -Infinity;
  for (const l of sorted) {
    const start = new Date(l.startsAt).getTime();
    const end = start + l.duration * 60000;
    if (current.length > 0 && start >= clusterEnd) {
      clusters.push(current);
      current = [];
      clusterEnd = -Infinity;
    }
    current.push(l);
    clusterEnd = Math.max(clusterEnd, end);
  }
  if (current.length > 0) clusters.push(current);

  const result: LessonLayout[] = [];
  for (const cluster of clusters) {
    const clusterStart = cluster[0]!.startsAt; // cluster is already chronological
    cluster.forEach((l, i) => {
      result.push({ ...l, stackIndex: i, stackSize: cluster.length, clusterStart });
    });
  }
  return result;
}

// ─── Instrument colours ───────────────────────────────────────────────────────
const INSTR_HUE: Record<string, string> = {
  piano: '#3D7A55', violin: '#2B6CB0', guitar: '#B7791F', drums: '#C05621',
  cello: '#553C9A', viola: '#2C7A7B', 'bass guitar': '#276749', vocal: '#97266D',
  ukulele: '#D69E2E', 'suzuki violin': '#2B6CB0', ensemble: '#718096',
};
function instrColor(name?: string | null) { return INSTR_HUE[(name ?? '').toLowerCase()] ?? '#4A5568'; }

// ─── Teacher colours — deterministic hash so each teacher gets a distinct, stable colour ──
const TEACHER_PALETTE = [
  '#2B6CB0', '#B7791F', '#553C9A', '#276749', '#C05621',
  '#97266D', '#2C7A7B', '#9B2C2C', '#1A4971', '#6B46C1',
  '#975A16', '#22543D',
];
// Index-based assignment from the currently loaded staff list guarantees no two
// teachers share a color (a pure hash can collide); falls back to a hash for any
// teacher not in the current list (e.g. inactive staff still referenced by a lesson).
// Beyond the fixed palette's size, colors are generated via hue rotation so any
// number of teachers stays distinct rather than wrapping back to reused hexes.
function colorAtIndex(i: number) {
  if (i < TEACHER_PALETTE.length) return TEACHER_PALETTE[i]!;
  const hue = Math.round((i * 360) / Math.max(TEACHER_PALETTE.length, 1)) % 360;
  return `hsl(${hue}, 55%, 38%)`;
}
let teacherColorMap: Record<string, string> = {};
function setTeacherColorMap(staffList: { id: string }[]) {
  const sorted = [...staffList].sort((a, b) => a.id.localeCompare(b.id));
  const map: Record<string, string> = {};
  sorted.forEach((s, i) => { map[s.id] = colorAtIndex(i); });
  teacherColorMap = map;
}
function teacherColor(teacherId?: string | null) {
  if (!teacherId) return '#718096';
  if (teacherColorMap[teacherId]) return teacherColorMap[teacherId];
  let hash = 0;
  for (let i = 0; i < teacherId.length; i++) hash = (hash * 31 + teacherId.charCodeAt(i)) >>> 0;
  return TEACHER_PALETTE[hash % TEACHER_PALETTE.length]!;
}

// ─── Status landmarks — a small icon badge showing what happened, independent
// of colour (which is now the teacher's). No entry = upcoming/normal, no badge.
const STATUS_LANDMARK: Record<string, { Icon: typeof Check; color: string; title: string }> = {
  completed:           { Icon: Check,  color: '#22543D', title: 'Present' },
  cancelled_makeup:    { Icon: Repeat, color: '#5B3F9E', title: 'Cancelled ≥24h — makeup credit issued' },
  cancelled_no_makeup: { Icon: X,      color: '#9B2C2C', title: 'Cancelled <24h — charged, no credit' },
  cancelled_no_pay:    { Icon: X,      color: '#7B341E', title: 'Excused — no charge, no credit' },
  cancelled_teacher:   { Icon: X,      color: '#744210', title: 'Teacher cancelled — no charge' },
};
const PAID_COLOR = '#22543D';
const UNPAID_COLOR = '#9B2C2C';

// ─── Lesson block ─────────────────────────────────────────────────────────────
function LessonBlock({ lesson, onClick }: { lesson: LessonLayout; onClick: () => void }) {
  const stacked = lesson.stackSize > 1;
  // All clusters use the earliest member's time to position the whole stack —
  // stacked rows are ordered, not clock-accurate past the first one, since a
  // block genuinely can't show both "which slot" and "exactly when" at once
  // once several lessons share the same moment.
  const clusterTop = (minutesFromDayStart(lesson.clusterStart) / 60) * PX_PER_HOUR;
  const top    = stacked ? clusterTop + lesson.stackIndex * STACK_ROW_H : clusterTop;
  const height = stacked ? STACK_ROW_H - 2 : Math.max((lesson.duration / 60) * PX_PER_HOUR - 2, 22);
  const width  = 'calc(100% - 3px)';

  const instr    = lesson.enrollment?.instrument;
  const isGrp    = lesson.enrollment?.lessonType === 'group';
  const tColor   = teacherColor(lesson.teacher?.id);
  const iColor   = instrColor(instr);
  const tall     = height >= 52;
  const xtall    = height >= 72;
  const landmark = STATUS_LANDMARK[lesson.status];
  // A substitute: someone other than the student's normal enrolled teacher is
  // covering this one occurrence.
  const isSub = !!lesson.enrollment?.teacherId && !!lesson.teacher && lesson.enrollment.teacherId !== lesson.teacher.id;
  // A cancelled lesson used to render with the exact same full-strength colour
  // as a live one — the only tell was a 10px icon — so a cancelled block still
  // read as "there's a lesson here" at a glance. Dim it and strike the name,
  // matching how the month view already marks cancellations.
  const cancelled = lesson.status.startsWith('cancelled');

  return (
    <button
      onClick={onClick}
      style={{
        top, height, left: 0, width,
        background: hexToRgba(tColor, cancelled ? 0.06 : 0.14),
        borderColor: hexToRgba(tColor, cancelled ? 0.3 : 0.55),
        opacity: cancelled ? 0.65 : 1,
      }}
      className="absolute rounded-lg border cursor-pointer text-left px-1.5 py-1 overflow-hidden transition-all hover:brightness-95 hover:shadow-md group z-10"
    >
      {/* Time range + status/payment landmarks */}
      <div className="flex items-center justify-between gap-1 mb-0.5">
        <p className="text-[9px] font-bold leading-none tabular-nums" style={{ color: tColor, opacity: 0.75 }}>
          {fmtTime(lesson.startsAt)}–{fmtTimeEnd(lesson.startsAt, lesson.duration)}
        </p>
        <span className="flex items-center gap-0.5 shrink-0">
          {isSub && <Shuffle size={9} style={{ color: tColor }} aria-label="Substitute teacher" />}
          {lesson.paymentStatus === 'paid' && <PoundSterling size={9} style={{ color: PAID_COLOR }} aria-label="Paid" />}
          {lesson.paymentStatus === 'unpaid' && <PoundSterling size={9} style={{ color: UNPAID_COLOR }} aria-label="Unpaid" />}
          {landmark && <landmark.Icon size={10} style={{ color: landmark.color }} aria-label={landmark.title} />}
        </span>
      </div>

      {/* Student name */}
      <p className="text-[11px] font-bold leading-tight truncate" style={{ color: tColor, textDecoration: cancelled ? 'line-through' : undefined }}>
        {lesson.student?.firstName} {lesson.student?.lastName}
      </p>

      {/* Instrument + type badge — always shown below the name (not gated on height) */}
      {instr && (
        <p className="flex items-center gap-1 mt-0.5">
          <span className="shrink-0" style={{ color: iColor }}><InstrumentIcon name={instr} size={11} /></span>
          <span className="text-[10px] font-semibold capitalize truncate" style={{ color: iColor }}>
            {instr}
          </span>
          {tall && (
            <span className={`text-[8px] font-bold px-1 py-px rounded-full leading-none shrink-0
              ${isGrp ? 'bg-blue-100 text-blue-700' : 'bg-[var(--sage-lt)] text-[var(--sage)]'}`}>
              {isGrp ? 'G' : 'P'}
            </span>
          )}
        </p>
      )}

      {/* Group name */}
      {xtall && isGrp && lesson.enrollment?.groupName && (
        <p className="text-[10px] italic leading-tight truncate" style={{ color: tColor, opacity: 0.65 }}>
          {lesson.enrollment.groupName}
        </p>
      )}

      {/* Teacher name */}
      {xtall && lesson.teacher && (
        <p className="flex items-center gap-1 mt-px">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: tColor }} />
          <span className="text-[10px] leading-tight truncate" style={{ color: tColor, opacity: 0.65 }}>
            {lesson.teacher.firstName} {lesson.teacher.lastName}{isSub ? ' (sub)' : ''}
          </span>
        </p>
      )}
    </button>
  );
}

// ─── Add lesson modal ─────────────────────────────────────────────────────────
interface SlotsResponse { date: string; weekday: string; noWindows: boolean; slots: string[]; }
type AddResult =
  | { kind: 'weekly'; created: number; through: string }
  | { kind: 'request'; teacherName: string; count: number };

function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const ap = (h ?? 0) < 12 ? 'am' : 'pm';
  const hr = ((h ?? 0) % 12) || 12;
  return `${hr}:${String(m ?? 0).padStart(2, '0')}${ap}`;
}

function AddLessonModal({ open, onClose, onCreated, defaultDate, defaultTime }: {
  open: boolean; onClose: () => void; onCreated: () => void;
  defaultDate?: string; defaultTime?: string;
}) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [studentsList, setStudentsList] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [lessonType, setLessonType] = useState<'private' | 'group'>('private');
  const [instrument, setInstrument] = useState('');
  const [groupName, setGroupName] = useState('');
  const [duration, setDuration] = useState('60');
  const [date, setDate] = useState(defaultDate ?? '');
  const [notes, setNotes] = useState('');
  // Availability-driven time selection.
  const [slots, setSlots] = useState<string[]>([]);
  const [noWindows, setNoWindows] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [picks, setPicks] = useState<string[]>([]);     // ranked HH:MM (1st, 2nd, 3rd)
  const [manualTime, setManualTime] = useState('');      // fallback when no teacher assigned
  const [letTeacherChoose, setLetTeacherChoose] = useState(true);
  const [repeat, setRepeat] = useState(false);
  // 'ongoing' = no end date, matching the family self-booking flow's default —
  // the daily recurrence worker keeps topping up new weeks forever on its own,
  // so there was never a real reason to force picking a stop point up front.
  const [repeatWeeks, setRepeatWeeks] = useState('ongoing');
  const [result, setResult] = useState<AddResult | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [isTeacher, setIsTeacher] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];
  // Validation errors (e.g. "no time picked") render at the top of the modal,
  // but the form is long enough to scroll — someone down at "Repeat weekly"
  // clicking submit saw nothing happen because the banner appeared off-screen
  // above the fold. Scroll it into view whenever a new error lands.
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [error]);

  useEffect(() => {
    if (!open) return;
    setStudentId(''); setTeacherId(''); setDuration('60');
    setLessonType('private'); setInstrument(''); setGroupName('');
    setDate(defaultDate ?? ''); setNotes('');
    setSlots([]); setNoWindows(false); setPicks([]); setManualTime(defaultTime ?? '');
    setLetTeacherChoose(true);
    setRepeat(false); setRepeatWeeks('ongoing'); setResult(null); setError('');
    const t = tok();
    const role = getRoleFromToken(t);
    const teacherSelf = role === 'teacher';
    setIsTeacher(teacherSelf);
    Promise.all([
      teacherSelf
        ? apiFetch<StaffMember | null>('/staff/me', { token: t }).catch(() => null).then(me => me ? [me] : [])
        : apiFetch<StaffMember[]>('/staff', { token: t }).catch(() => []),
      apiFetch<Student[]>('/students', { token: t }).catch(() => []),
    ]).then(([s, st]) => {
      setStaff(s);
      setStudentsList(st);
      if (teacherSelf && s[0]) setTeacherId(s[0].id);
    });
  }, [open, defaultDate, defaultTime]);

  // A teacher booking for themselves is the one choosing the time, so the
  // "let the teacher pick" hand-off doesn't apply. Recurring weekly bookings and
  // unassigned lessons are always booked directly too (there's no teacher to ask).
  const isUnassigned = !teacherId;
  const requestMode = !isTeacher && !isUnassigned && !repeat && letTeacherChoose;

  // Fetch the teacher's bookable slots whenever teacher / date / duration change.
  useEffect(() => {
    if (!open || !teacherId || !date) { setSlots([]); setNoWindows(false); return; }
    const t = tok();
    setLoadingSlots(true);
    const dur = parseInt(duration) || 60;
    apiFetch<SlotsResponse>(`/scheduling/available-slots?teacherId=${teacherId}&date=${date}&duration=${dur}`, { token: t })
      .then(res => {
        setSlots(res.slots); setNoWindows(res.noWindows);
        // Drop any ranked picks that are no longer offered (date/duration changed).
        setPicks(prev => prev.filter(p => res.slots.includes(p)));
      })
      .catch(() => { setSlots([]); setNoWindows(false); })
      .finally(() => setLoadingSlots(false));
  }, [open, teacherId, date, duration]);

  function toggleSlot(label: string) {
    if (requestMode) {
      setPicks(prev => prev.includes(label)
        ? prev.filter(p => p !== label)
        : prev.length >= 3 ? prev : [...prev, label]);
    } else {
      setPicks(prev => (prev[0] === label ? [] : [label]));  // single pick for direct booking
    }
  }

  const instrumentOptions = lessonType === 'private' ? PRIVATE_INSTRUMENTS : GROUP_INSTRUMENTS;
  const durationOptions = lessonType === 'private'
    ? [{ value: '30', label: '30 min' }, { value: '45', label: '45 min' }, { value: '60', label: '60 min' }]
    : [{ value: '60', label: '60 min' }];
  const teacherName = staff.find(s => s.id === teacherId)?.firstName ?? 'the teacher';

  async function ensureEnrollmentId(t?: string): Promise<string> {
    // Find or create a matching enrollment so the lesson carries instrument + type (+ group name).
    const detail = await apiFetch<StudentDetail>(`/students/${studentId}`, { token: t });
    const existing = detail.enrollments.find(
      en => en.instrument === instrument && en.lessonType === lessonType && en.status !== 'withdrawn'
        && (lessonType !== 'group' || (en.groupName ?? '') === groupName.trim()),
    );
    if (existing) {
      // A matching enrollment can predate this booking and carry a different (or
      // no) teacher. Without reconciling it, this dialog's teacher choice is
      // cosmetic — recurring materialization reads enrollment.teacherId, not
      // what's shown here, so "repeat weekly" would silently book the OLD
      // teacher's series instead of the one just picked.
      if (teacherId && (existing.teacherId ?? '') !== teacherId) {
        await apiFetch(`/enrollments/${existing.id}`, {
          method: 'PATCH', token: t, body: JSON.stringify({ teacherId }),
        });
      }
      return existing.id;
    }
    const created = await apiFetch<{ id: string }>(`/students/${studentId}/enrollments`, {
      method: 'POST', token: t, body: JSON.stringify({
        instrument, lessonType, duration: parseInt(duration) || 60,
        groupName: lessonType === 'group' && groupName.trim() ? groupName.trim() : undefined,
        teacherId: teacherId || undefined,
        rate: lessonRate(lessonType, parseInt(duration) || 60),
        autoRenew: false, status: 'active',
      }),
    });
    return created.id;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!studentId) { setError('Please select a student'); return; }
    if (!instrument) { setError('Please select an instrument or group'); return; }
    if (!date) { setError('Please pick a date'); return; }

    // Resolve the chosen time(s). Unassigned lessons use the manual time; every
    // teacher-assigned lesson is picked from their availability slots.
    const times = isUnassigned ? (manualTime ? [manualTime] : []) : picks;
    if (times.length === 0) {
      setError(isUnassigned ? 'Please enter a time' : `Please choose an available time in ${teacherName}'s hours`);
      return;
    }

    setSaving(true); setError('');
    const t = tok();
    try {
      const enrollmentId = await ensureEnrollmentId(t);

      if (repeat) {
        // Set the enrollment's weekly schedule (weekday derived from the picked
        // date), then materialise the series so every week appears at once.
        // `date` is already a studio-zone "YYYY-MM-DD" string; parsing it as
        // "...T12:00:00" (no Z) reads it back in the BROWSER's zone via getDay(),
        // which for a large enough offset can name the wrong weekday for the
        // recurring rule actually written to the enrollment. Anchor at noon UTC
        // and read getUTCDay() instead — zone-independent, same as elsewhere.
        const weekday = WEEKDAY_KEYS[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7];
        // A finite pick needs its own endDate on the rule — without it the
        // daily recurrence worker has no way to know to stop, and would just
        // keep extending the series forever regardless of what was chosen here.
        const endDate = repeatWeeks === 'ongoing'
          ? undefined
          : studioDayString(new Date(new Date(`${date}T12:00:00Z`).getTime() + (parseInt(repeatWeeks) || 12) * 7 * 86400000));
        await apiFetch(`/enrollments/${enrollmentId}`, {
          method: 'PATCH', token: t, body: JSON.stringify({ scheduleRule: { weekday, startTime: times[0], endDate } }),
        });
        const r = await apiFetch<{ created: number; through: string }>('/lessons/recurring', {
          method: 'POST', token: t,
          body: JSON.stringify({
            enrollmentId,
            // 'ongoing': omit weeks entirely so the API's own default window
            // applies — the series doesn't stop there, the daily worker keeps
            // extending it for as long as the enrolment stays active.
            weeks: repeatWeeks === 'ongoing' ? undefined : parseInt(repeatWeeks) || undefined,
            startFrom: date,
          }),
        });
        onCreated();
        setResult({ kind: 'weekly', created: r.created, through: r.through });
      } else if (requestMode) {
        // Hand the ranked times to the teacher — no lesson exists until they confirm.
        await apiFetch('/lesson-requests', { method: 'POST', token: t, body: JSON.stringify({
          studentId, teacherId, enrollmentId,
          duration: parseInt(duration) || 60,
          proposedStartsAt: `${date}T${times[0]}:00`,
          proposedStartsAt2: times[1] ? `${date}T${times[1]}:00` : undefined,
          proposedStartsAt3: times[2] ? `${date}T${times[2]}:00` : undefined,
          notes: notes || undefined,
        })});
        setResult({ kind: 'request', teacherName, count: times.length });
      } else {
        await apiFetch('/lessons', { method: 'POST', token: t, body: JSON.stringify({
          studentId, teacherId: teacherId || undefined,
          enrollmentId,
          startsAt: `${date}T${times[0]}:00`,
          duration: parseInt(duration) || 60,
          notes: notes || undefined,
        })});
        onCreated(); onClose();
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  const submitLabel = saving ? 'Saving…'
    : repeat ? 'Book weekly lessons'
    : requestMode ? `Send to ${teacherName} to confirm`
    : 'Add lesson';

  return (
    <Modal open={open} onClose={onClose} title="Add lesson">
      {error && (
        <div ref={errorRef} className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}
      {result ? (
        <div className="space-y-4">
          <div className="rounded-xl px-4 py-4 text-sm"
            style={{ background: 'var(--sage-lt)', color: 'var(--sage-dk)', border: '1px solid var(--sage)' }}>
            {result.kind === 'weekly' ? (
              <>
                <p className="font-bold text-base mb-1">Weekly lessons booked ✓</p>
                {result.created > 0 ? (
                  <p>Added <strong>{result.created}</strong> weekly lesson{result.created !== 1 ? 's' : ''} through{' '}
                    {new Date(result.through).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.</p>
                ) : (
                  <p>No new lessons were booked — they may already exist for this weekly slot.</p>
                )}
              </>
            ) : (
              <>
                <p className="font-bold text-base mb-1">Sent to {result.teacherName} ✓</p>
                <p>Proposed <strong>{result.count}</strong> time{result.count !== 1 ? 's' : ''}. {result.teacherName} will pick one to confirm —
                  it appears on the calendar the moment they do. You can track it under <strong>Booking requests</strong>.</p>
              </>
            )}
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="ui-btn-primary">Done</button>
          </div>
        </div>
      ) : (
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="ui-label">Student <span style={{ color: 'var(--coral)' }}>*</span></label>
          <SearchableSelect
            options={studentsList.map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
            value={studentId} onChange={setStudentId} placeholder="Select student…"
          />
        </div>

        <div>
          <label className="ui-label">Lesson type <span style={{ color: 'var(--coral)' }}>*</span></label>
          <div className="flex gap-1 p-1 rounded-xl border border-[var(--bd)]" style={{ background: 'var(--bg2)' }}>
            {(['private', 'group'] as const).map(t => (
              <button
                key={t} type="button"
                onClick={() => { setLessonType(t); setInstrument(''); if (t === 'group') setDuration('60'); }}
                className="flex-1 text-sm py-1.5 rounded-lg font-semibold capitalize transition-all"
                style={{
                  background: lessonType === t ? 'white' : 'transparent',
                  color: lessonType === t ? 'var(--txt)' : 'var(--txt4)',
                  boxShadow: lessonType === t ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="ui-label">{lessonType === 'private' ? 'Instrument' : 'Group type'} <span style={{ color: 'var(--coral)' }}>*</span></label>
          <SearchableSelect
            options={instrumentOptions.map(i => ({ value: i, label: i.charAt(0).toUpperCase() + i.slice(1) }))}
            value={instrument} onChange={setInstrument} placeholder="Select…"
          />
        </div>

        {lessonType === 'group' && (
          <div>
            <label className="ui-label">Group name</label>
            <input
              value={groupName} onChange={e => setGroupName(e.target.value)}
              placeholder="e.g. Tuesday 4pm Ensemble" className="ui-input"
            />
          </div>
        )}

        {!isTeacher && (
          <div>
            <label className="ui-label">Teacher</label>
            <SearchableSelect
              options={staff.map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
              value={teacherId} onChange={setTeacherId} emptyLabel="Unassigned"
            />
          </div>
        )}
        <div>
          <label className="ui-label">Duration</label>
          <SearchableSelect options={durationOptions} value={duration} onChange={setDuration} disabled={lessonType === 'group'} />
        </div>

        <div>
          <label className="ui-label">Date <span style={{ color: 'var(--coral)' }}>*</span></label>
          <input type="date" required value={date} onChange={e => setDate(e.target.value)} className="ui-input" />
        </div>

        {/* Time — availability-driven when a teacher is assigned, manual otherwise */}
        <div>
          <label className="ui-label flex items-center gap-1.5">
            {requestMode ? 'Preferred times' : 'Time'} <span style={{ color: 'var(--coral)' }}>*</span>
            {!isUnassigned && (
              <InfoTooltip text={requestMode
                ? `Pick up to three times inside ${teacherName}'s working hours. ${teacherName} confirms whichever suits — the lesson is only booked once they do.`
                : `Only times inside ${teacherName}'s working hours that are free of other lessons are shown, so you can't double-book.`} />
            )}
          </label>

          {isUnassigned ? (
            <>
              <input type="time" value={manualTime} onChange={e => setManualTime(e.target.value)} className="ui-input" />
              <p className="text-[11px] mt-1" style={{ color: 'var(--txt4)' }}>
                Assign a teacher above to pick from their available times.
              </p>
            </>
          ) : !date ? (
            <p className="text-sm" style={{ color: 'var(--txt4)' }}>Pick a date to see available times.</p>
          ) : loadingSlots ? (
            <p className="text-sm" style={{ color: 'var(--txt4)' }}>Finding {teacherName}&rsquo;s free times…</p>
          ) : slots.length === 0 ? (
            <div className="rounded-xl px-3.5 py-3 text-sm"
              style={{ background: 'var(--surf)', color: 'var(--txt3)', border: '1px solid var(--bd)' }}>
              No free times in {teacherName}&rsquo;s hours that day. Try another date, a shorter duration, or check their availability.
            </div>
          ) : (
            <>
              {noWindows && (
                <p className="text-[11px] mb-1.5" style={{ color: 'var(--coral)' }}>
                  {teacherName} hasn&rsquo;t set working hours yet — showing the full day. Set their availability for tighter suggestions.
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {slots.map(s => {
                  const rank = picks.indexOf(s);
                  const active = rank >= 0;
                  return (
                    <button
                      key={s} type="button" onClick={() => toggleSlot(s)}
                      className="text-xs font-semibold rounded-lg px-2.5 py-1.5 tabular-nums transition-colors flex items-center gap-1.5"
                      style={{
                        background: active ? 'var(--sage)' : 'white',
                        color: active ? 'white' : 'var(--txt2)',
                        border: `1.5px solid ${active ? 'var(--sage)' : 'var(--bd2)'}`,
                      }}
                    >
                      {requestMode && active && (
                        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold"
                          style={{ background: 'rgba(255,255,255,0.3)' }}>{rank + 1}</span>
                      )}
                      {to12h(s)}
                    </button>
                  );
                })}
              </div>
              {requestMode && (
                <p className="text-[11px] mt-1.5" style={{ color: 'var(--txt4)' }}>
                  {picks.length === 0
                    ? `Tap up to 3 times in order of preference — ${teacherName} confirms one.`
                    : `Ranked: ${picks.map((p, i) => `${i + 1}. ${to12h(p)}`).join('  ')}`}
                </p>
              )}
            </>
          )}
        </div>

        {/* Let the teacher pick the final time (front desk only, single non-recurring lesson) */}
        {!isTeacher && !isUnassigned && !repeat && (
          <div className="rounded-xl border p-3" style={{ borderColor: letTeacherChoose ? 'var(--sage)' : 'var(--bd)', background: letTeacherChoose ? 'var(--sage-lt)' : 'transparent' }}>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={letTeacherChoose} onChange={e => { setLetTeacherChoose(e.target.checked); setPicks([]); }}
                className="h-4 w-4 rounded mt-0.5" style={{ accentColor: 'var(--sage)' }} />
              <span>
                <span className="text-sm font-semibold block" style={{ color: 'var(--txt)' }}>Let {teacherName} pick the final time</span>
                <span className="text-[11px]" style={{ color: 'var(--txt3)' }}>
                  {letTeacherChoose
                    ? `Propose up to 3 times; ${teacherName} confirms one and it's added then.`
                    : 'Off: the lesson is booked immediately at the time you choose.'}
                </span>
              </span>
            </label>
          </div>
        )}

        {!repeat && (
          <div>
            <label className="ui-label">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="ui-input" style={{ resize: 'vertical' }} />
          </div>
        )}

        {/* Repeat weekly — turns this into a recurring weekly booking (booked directly) */}
        <div className="rounded-xl border p-3" style={{ borderColor: repeat ? 'var(--sage)' : 'var(--bd)', background: repeat ? 'var(--sage-lt)' : 'transparent' }}>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={repeat} onChange={e => { setRepeat(e.target.checked); setPicks([]); }}
              className="h-4 w-4 rounded" style={{ accentColor: 'var(--sage)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>Repeat weekly</span>
          </label>
          {repeat && (
            <div className="mt-3">
              <div className="flex items-center gap-2">
                <span className="text-sm" style={{ color: 'var(--txt3)' }}>Book this slot</span>
                <div className="w-44">
                  <SearchableSelect
                    options={[
                      { value: 'ongoing', label: 'Ongoing (no end date)' },
                      ...[4, 8, 12, 16, 24, 36, 52].map(w => ({ value: String(w), label: `${w} weeks, then stop` })),
                    ]}
                    value={repeatWeeks} onChange={setRepeatWeeks}
                  />
                </div>
              </div>
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--txt4)' }}>
                {repeatWeeks === 'ongoing'
                  ? 'Keeps booking every week automatically until someone cancels it.'
                  : `Books every week for ${repeatWeeks} weeks, then stops on its own.`}
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving} className="ui-btn-primary">
            {submitLabel}
          </button>
          <button type="button" onClick={onClose} className="ui-btn-ghost">Cancel</button>
        </div>
      </form>
      )}
    </Modal>
  );
}

// ─── New default lesson modal ─────────────────────────────────────────────────
// Quick-add shortcut: pick a student, resolve their active enrollment, and only
// ask for date/time — teacher, duration, and rate are taken from the enrollment.
function NewDefaultLessonModal({ open, onClose, onCreated, defaultDate, defaultTime }: {
  open: boolean; onClose: () => void; onCreated: () => void;
  defaultDate?: string; defaultTime?: string;
}) {
  const [studentsList, setStudentsList] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState('');
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [enrollmentId, setEnrollmentId] = useState('');
  const [loadingEnrollments, setLoadingEnrollments] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  useEffect(() => {
    if (!open) return;
    setStudentId(''); setEnrollments([]); setEnrollmentId(''); setError('');
    apiFetch<Student[]>('/students', { token: tok() }).then(setStudentsList).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!studentId) { setEnrollments([]); setEnrollmentId(''); return; }
    setLoadingEnrollments(true); setError('');
    apiFetch<StudentDetail>(`/students/${studentId}`, { token: tok() })
      .then(detail => {
        const active = detail.enrollments.filter(e => e.status === 'active');
        setEnrollments(active);
        setEnrollmentId(active.length === 1 ? active[0]!.id : '');
        if (active.length === 0) setError('This student has no active enrollment — use "Add lesson" instead.');
      })
      .catch(() => setError("Could not load this student's enrollments"))
      .finally(() => setLoadingEnrollments(false));
  }, [studentId]);

  const selectedEnrollment = enrollments.find(e => e.id === enrollmentId);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedEnrollment) { setError('Select a student with an active enrollment'); return; }
    setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    try {
      await apiFetch('/lessons', { method: 'POST', token: tok(), body: JSON.stringify({
        studentId, enrollmentId: selectedEnrollment.id,
        teacherId: selectedEnrollment.teacherId ?? undefined,
        startsAt: `${f.get('date')}T${f.get('time')}:00`,
        duration: selectedEnrollment.defaultDuration ?? 60,
      })});
      onCreated(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="New default lesson">
      {error && (
        <div className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="ui-label">Student <span style={{ color: 'var(--coral)' }}>*</span></label>
          <SearchableSelect
            options={studentsList.map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
            value={studentId} onChange={setStudentId} placeholder="Select student…"
          />
        </div>

        {studentId && loadingEnrollments && (
          <p className="text-sm" style={{ color: 'var(--txt4)' }}>Loading enrollments…</p>
        )}

        {studentId && enrollments.length > 1 && (
          <div>
            <label className="ui-label">Enrollment <span style={{ color: 'var(--coral)' }}>*</span></label>
            <div className="space-y-1.5">
              {enrollments.map(en => (
                <label key={en.id} className="flex items-center gap-2 text-sm rounded-xl px-3 py-2 border cursor-pointer"
                  style={{ borderColor: enrollmentId === en.id ? 'var(--sage)' : 'var(--bd)' }}>
                  <input type="radio" name="enrollment" checked={enrollmentId === en.id} onChange={() => setEnrollmentId(en.id)} />
                  <span className="capitalize font-medium">{en.instrument}</span>
                  <span style={{ color: 'var(--txt4)' }}>
                    · {en.defaultDuration ?? 60} min{en.groupName ? ` · ${en.groupName}` : ''}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {selectedEnrollment && (
          <div className="rounded-xl px-3.5 py-2.5 text-sm" style={{ background: 'var(--surf)', border: '1px solid var(--bd)', color: 'var(--txt3)' }}>
            Will book a <strong className="capitalize" style={{ color: 'var(--txt)' }}>
              {selectedEnrollment.defaultDuration ?? 60}-min {selectedEnrollment.instrument}
            </strong> lesson at the enrollment&rsquo;s usual rate and teacher.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ui-label">Date <span style={{ color: 'var(--coral)' }}>*</span></label>
            <input name="date" type="date" required defaultValue={defaultDate} className="ui-input" />
          </div>
          <div>
            <label className="ui-label">Time <span style={{ color: 'var(--coral)' }}>*</span></label>
            <input name="time" type="time" required defaultValue={defaultTime ?? '16:00'} className="ui-input" />
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving || !selectedEnrollment} className="ui-btn-primary">
            {saving ? 'Saving…' : 'Add lesson'}
          </button>
          <button type="button" onClick={onClose} className="ui-btn-ghost">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Lesson detail modal ──────────────────────────────────────────────────────
const PRIVATE_ATTENDANCE = [
  { status: 'present',           label: 'Present', hint: 'Lesson happened as scheduled.' },
  { status: 'absent_makeup',     label: 'Cancelled ≥24h notice', hint: 'No charge — makeup credit issued, teacher not paid.' },
  { status: 'absent_no_makeup',  label: 'Cancelled <24h notice', hint: 'Family is charged, no credit given, teacher is still paid.' },
  { status: 'absent_no_pay',     label: 'Excused (no charge)', hint: 'No charge, no credit, teacher not paid — e.g. studio-approved exception.' },
  { status: 'cancelled_teacher', label: 'Teacher cancelled', hint: 'No charge to the family, teacher not paid for this slot.' },
] as const;
const GROUP_ATTENDANCE = [
  { status: 'present',           label: 'Present', hint: 'Lesson happened as scheduled.' },
  { status: 'absent_no_pay',     label: 'Absent', hint: 'No charge, no credit, teacher not paid.' },
  { status: 'cancelled_teacher', label: 'Cancelled', hint: 'No charge to the family, teacher not paid for this slot.' },
] as const;

const PAYMENT_LABEL: Record<string, { label: string; color: string }> = {
  paid:     { label: 'Paid',            color: 'var(--sage-dk)' },
  unpaid:   { label: 'Unpaid',          color: 'var(--coral)' },
  void:     { label: 'Voided invoice',  color: 'var(--txt4)' },
  unbilled: { label: 'Not yet billed',  color: 'var(--txt4)' },
};

function LessonDetailModal({ lesson, open, onClose, onUpdated, readOnly = false, canManage = false, staffOptions = [] }: {
  lesson: Lesson | null; open: boolean; onClose: () => void; onUpdated: () => void;
  // When a teacher is viewing another teacher's lesson from the whole-studio
  // calendar: the schedule is visible but attendance/reschedule/cancel are not
  // theirs to touch (the API would refuse anyway — this just hides dead buttons).
  readOnly?: boolean;
  // Admin/receptionist+ only — teachers can't reassign lessons, so the
  // substitute picker only renders for roles that can actually call it.
  canManage?: boolean;
  staffOptions?: StaffMember[];
}) {
  const [saving, setSaving] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [actionError, setActionError] = useState('');
  const [showSub, setShowSub] = useState(false);
  const [subTeacherId, setSubTeacherId] = useState('');
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  useEffect(() => {
    setShowReschedule(false); setActionError(''); setShowSub(false); setSubTeacherId('');
    if (lesson) {
      // Prefill date + time in the studio zone so they match what's shown elsewhere
      // and round-trip correctly (the backend interprets the naive value as studio-local).
      setNewDate(studioDayString(lesson.startsAt));
      setNewTime(fmtTime(lesson.startsAt));
    }
  }, [lesson?.id]);

  if (!lesson) return null;

  async function markAttendance(status: string) {
    setSaving(true);
    try {
      await apiFetch(`/lessons/${lesson!.id}/attendance`, { method: 'POST', token: tok(), body: JSON.stringify({ status }) });
      onUpdated(); onClose();
    } catch (e) { console.error(e); } finally { setSaving(false); }
  }

  async function cancelLesson() {
    const who = lesson!.student ? `${lesson!.student.firstName} ${lesson!.student.lastName}'s` : 'this';
    if (!confirm(`Cancel ${who} lesson on ${fmtDate(lesson!.startsAt)} at ${fmtTime(lesson!.startsAt)}? This removes it from the calendar with no charge to the family and no pay to the teacher. It can't be undone from here — you'd need to book it again.`)) return;
    setSaving(true); setActionError('');
    try {
      await apiFetch(`/lessons/${lesson!.id}/cancel`, {
        method: 'POST', token: tok(), body: JSON.stringify({ reason: 'cancelled_teacher' }),
      });
      onUpdated(); onClose();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not cancel lesson');
    } finally { setSaving(false); }
  }

  async function reinstateLesson() {
    setSaving(true); setActionError('');
    try {
      await apiFetch(`/lessons/${lesson!.id}/reinstate`, { method: 'POST', token: tok() });
      onUpdated(); onClose();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not reinstate lesson');
    } finally { setSaving(false); }
  }

  async function assignSubstitute() {
    if (!subTeacherId) return;
    setSaving(true); setActionError('');
    try {
      await apiFetch(`/lessons/${lesson!.id}`, {
        method: 'PATCH', token: tok(), body: JSON.stringify({ teacherId: subTeacherId }),
      });
      onUpdated(); onClose();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not assign substitute — check they\'re free at this time');
    } finally { setSaving(false); }
  }

  async function rescheduleLesson() {
    if (!newDate || !newTime) return;
    setSaving(true); setActionError('');
    try {
      await apiFetch(`/lessons/${lesson!.id}/reschedule`, {
        method: 'POST', token: tok(), body: JSON.stringify({ startsAt: `${newDate}T${newTime}:00` }),
      });
      onUpdated(); onClose();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not reschedule lesson');
    } finally { setSaving(false); }
  }

  const instr = lesson.enrollment?.instrument;
  const isGrp = lesson.enrollment?.lessonType === 'group';
  const actions = isGrp ? GROUP_ATTENDANCE : PRIVATE_ATTENDANCE;
  const isSub = !!lesson.enrollment?.teacherId && !!lesson.teacher && lesson.enrollment.teacherId !== lesson.teacher.id;
  const normalTeacher = staffOptions.find(s => s.id === lesson.enrollment?.teacherId);
  const payment = lesson.paymentStatus ? PAYMENT_LABEL[lesson.paymentStatus] : null;
  const canSub = canManage && !readOnly && (lesson.status === 'scheduled' || lesson.status === 'makeup');

  return (
    <Modal open={open} onClose={onClose} title="Lesson details">
      <div className="space-y-4">
        {/* Detail block */}
        <div className="rounded-xl p-4 space-y-2.5 text-sm"
          style={{ background: 'var(--surf)', border: '1px solid var(--bd)' }}>
          <div className="flex justify-between items-start gap-4">
            <span className="shrink-0" style={{ color: 'var(--txt3)' }}>Date &amp; time</span>
            <span className="font-semibold text-right">
              {fmtDate(lesson.startsAt, { weekday: 'long', day: 'numeric', month: 'long' })}
              {', '}{fmtTime(lesson.startsAt)} – {fmtTimeEnd(lesson.startsAt, lesson.duration)}
            </span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--txt3)' }}>Duration</span>
            <span className="font-medium">{lesson.duration} min</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--txt3)' }}>Student</span>
            <span className="font-medium">{lesson.student?.firstName} {lesson.student?.lastName}</span>
          </div>
          {instr && (
            <div className="flex justify-between items-center">
              <span style={{ color: 'var(--txt3)' }}>Instrument</span>
              <span className="flex items-center gap-2 font-medium capitalize">
                <span style={{ color: instrColor(instr) }}>{instr}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isGrp ? 'bg-blue-100 text-blue-700' : 'bg-[var(--sage-lt)] text-[var(--sage)]'}`}>
                  {isGrp ? 'Group' : 'Private'}
                </span>
              </span>
            </div>
          )}
          {isGrp && lesson.enrollment?.groupName && (
            <div className="flex justify-between">
              <span style={{ color: 'var(--txt3)' }}>Group</span>
              <span className="font-medium">{lesson.enrollment.groupName}</span>
            </div>
          )}
          <div className="flex justify-between items-start gap-4">
            <span className="shrink-0" style={{ color: 'var(--txt3)' }}>Teacher</span>
            <span className="text-right">
              <span className="font-medium">{lesson.teacher ? `${lesson.teacher.firstName} ${lesson.teacher.lastName}` : '—'}</span>
              {isSub && (
                <span className="flex items-center justify-end gap-1 text-[11px] mt-0.5" style={{ color: 'var(--txt4)' }}>
                  <Shuffle size={11} /> covering for {normalTeacher ? `${normalTeacher.firstName} ${normalTeacher.lastName}` : 'usual teacher'}
                </span>
              )}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span style={{ color: 'var(--txt3)' }}>Status</span>
            <Badge variant={lesson.status}>{lessonStatusLabel(lesson.status)}</Badge>
          </div>
          {payment && (
            <div className="flex justify-between items-center">
              <span style={{ color: 'var(--txt3)' }}>Payment</span>
              <span className="font-semibold flex items-center gap-1" style={{ color: payment.color }}>
                <PoundSterling size={12} /> {payment.label}
              </span>
            </div>
          )}
          {lesson.attendance && (
            <div className="flex justify-between items-center">
              <span style={{ color: 'var(--txt3)' }}>Attendance</span>
              <Badge variant={lesson.attendance.status}>{attendanceStatusLabel(lesson.attendance.status)}</Badge>
            </div>
          )}
        </div>

        {readOnly && (
          <p className="text-[12px] rounded-xl px-3.5 py-2.5" style={{ background: 'var(--surf)', color: 'var(--txt3)', border: '1px solid var(--bd)' }}>
            You&apos;re viewing another teacher&apos;s lesson. Only {lesson.teacher ? `${lesson.teacher.firstName} ${lesson.teacher.lastName}` : 'its teacher'} or the office can change it.
          </p>
        )}

        {!readOnly && lesson.status === 'scheduled' && (
          <div>
            <p className="text-sm font-semibold mb-2" style={{ color: 'var(--txt2)' }}>Mark attendance</p>
            <div className="grid grid-cols-1 gap-2">
              {actions.map(a => (
                <button key={a.status} onClick={() => markAttendance(a.status)} disabled={saving}
                  className="text-left text-sm rounded-[9px] px-3 py-2 transition-colors disabled:opacity-50"
                  style={{ border: '1.5px solid var(--bd2)', color: 'var(--txt2)', background: '#fff' }}
                  onMouseOver={e => (e.currentTarget.style.background = 'var(--surf)')}
                  onMouseOut={e => (e.currentTarget.style.background = '#fff')}>
                  <span className="font-medium block">{a.label}</span>
                  <span className="text-[11px] block mt-0.5" style={{ color: 'var(--txt4)' }}>{a.hint}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {canSub && (
          <div>
            {showSub ? (
              <div className="rounded-xl p-3.5 space-y-3" style={{ background: 'var(--surf)', border: '1px solid var(--bd)' }}>
                <p className="text-sm font-semibold" style={{ color: 'var(--txt2)' }}>Cover with a substitute teacher</p>
                <SearchableSelect
                  value={subTeacherId}
                  onChange={setSubTeacherId}
                  options={staffOptions.filter(s => s.id !== lesson.teacher?.id).map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
                  placeholder="Choose a substitute…"
                />
                <div className="flex gap-2">
                  <button onClick={assignSubstitute} disabled={saving || !subTeacherId} className="ui-btn-primary text-sm">
                    {saving ? 'Saving…' : 'Assign substitute'}
                  </button>
                  <button onClick={() => setShowSub(false)} className="ui-btn-ghost text-sm">Cancel</button>
                </div>
                <p className="text-[11px]" style={{ color: 'var(--txt4)' }}>
                  This changes the teacher for just this one lesson — it won&apos;t affect the student&apos;s regular enrolment or future lessons.
                </p>
              </div>
            ) : (
              <button onClick={() => setShowSub(true)} disabled={saving}
                className="ui-btn-ghost text-sm w-full flex items-center justify-center gap-1.5 disabled:opacity-50">
                <Shuffle size={14} /> Assign a substitute teacher
              </button>
            )}
          </div>
        )}

        {actionError && (
          <div className="text-sm rounded-xl px-4 py-3"
            style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
            {actionError}
          </div>
        )}

        {!readOnly && lesson.status === 'scheduled' && (
          <div>
            {showReschedule ? (
              <div className="rounded-xl p-3.5 space-y-3" style={{ background: 'var(--surf)', border: '1px solid var(--bd)' }}>
                <p className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--txt2)' }}>
                  Reschedule to
                  <InfoTooltip text="We'll check the new time is free and inside the teacher's working hours — so you can't accidentally double-book a teacher, or pick a time they're unavailable." />
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="ui-input" />
                  <input type="time" value={newTime} onChange={e => setNewTime(e.target.value)} className="ui-input" />
                </div>
                <div className="flex gap-2">
                  <button onClick={rescheduleLesson} disabled={saving} className="ui-btn-primary text-sm">
                    {saving ? 'Saving…' : 'Confirm reschedule'}
                  </button>
                  <button onClick={() => setShowReschedule(false)} className="ui-btn-ghost text-sm">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => setShowReschedule(true)} disabled={saving}
                  className="ui-btn-ghost text-sm flex-1 disabled:opacity-50">
                  Reschedule
                </button>
                <button onClick={cancelLesson} disabled={saving}
                  className="text-sm flex-1 rounded-[9px] px-3 py-2 font-semibold transition-colors disabled:opacity-50"
                  style={{ border: '1.5px solid var(--coral)', color: 'var(--coral)', background: '#fff' }}>
                  Cancel lesson
                </button>
              </div>
            )}
          </div>
        )}

        {!readOnly && lesson.status.startsWith('cancelled_') && !lesson.attendance && (
          <div>
            <button onClick={reinstateLesson} disabled={saving}
              className="text-sm w-full rounded-[9px] px-3 py-2 font-semibold transition-colors disabled:opacity-50"
              style={{ border: '1.5px solid var(--sage-md)', color: 'var(--sage-dk)', background: 'var(--sage-lt)' }}>
              {saving ? 'Reinstating…' : 'Reinstate lesson'}
            </button>
            <p className="text-[11px] mt-1.5 text-center" style={{ color: 'var(--txt4)' }}>
              Puts this cancelled lesson back on the calendar (we&apos;ll re-check the slot is free).
            </p>
          </div>
        )}

        {lesson.notes && (
          <p className="text-sm italic rounded-xl p-3.5"
            style={{ color: 'var(--txt3)', background: 'var(--surf)', border: '1px solid var(--bd)' }}>
            &ldquo;{lesson.notes}&rdquo;
          </p>
        )}
      </div>
    </Modal>
  );
}

// ─── Main calendar page ───────────────────────────────────────────────────────
export default function CalendarPage() {
  const [view, setView] = useState<'week' | 'day' | 'month'>('week');
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  // Month view renders all 6 weeks and lets the browser scroll — with today
  // late in the month that means landing on the top row and scrolling down
  // every single time. Jump straight to today's row (still scrollable up to
  // see earlier weeks) whenever month view starts showing the current month.
  const todayCellRef = useRef<HTMLButtonElement>(null);
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [showAdd, setShowAdd] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [slotDate, setSlotDate] = useState<string | undefined>();
  const [slotTime, setSlotTime] = useState<string | undefined>();
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  const weekStart = getWeekStart(anchorDate);
  const role = useRole();
  // "Assign students" / "Add student" are front-desk tasks — only management
  // roles get them. Teachers, and any parent/student who lands here, do not.
  const isManagement = role === 'admin';

  // Whole-studio view. Management always sees everyone; a teacher normally sees
  // only their own lessons but can opt in to the full schedule (read-only for
  // other teachers' lessons — see the `scope=all` handling on the API).
  const [wholeStudio, setWholeStudio] = useState(false);
  const teacherEveryone = role === 'teacher' && wholeStudio;
  // Filters, applied client-side so the dropdowns keep their full option lists
  // rather than collapsing to whatever is currently selected.
  const [filterTeacherId, setFilterTeacherId] = useState<string>('');
  const [filterStudentId, setFilterStudentId] = useState<string>('');

  // The visible date range: week/day both page by week; month spans the whole
  // 6-week grid so lessons that fall on the leading/trailing days still show.
  const monthGrid = getMonthGrid(anchorDate);
  const monthShowsToday =
    monthGrid.monthStart.getFullYear() === new Date().getFullYear() &&
    monthGrid.monthStart.getMonth() === new Date().getMonth();
  // Depend on the month/year, not the monthGrid object (a fresh Date each
  // render) — otherwise this would re-fire on every lesson refetch and yank
  // the view back down while someone's mid-scroll reading an earlier week.
  useEffect(() => {
    if (view === 'month' && monthShowsToday) {
      todayCellRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [view, monthShowsToday]);
  const lessonsQuery = (() => {
    const p = new URLSearchParams();
    if (view === 'month') {
      p.set('from', formatDate(monthGrid.gridStart));
      p.set('to', formatDate(monthGrid.gridEnd));
    } else {
      p.set('weekStart', formatDate(weekStart));
    }
    if (teacherEveryone) p.set('scope', 'all');
    return `/lessons?${p.toString()}`;
  })();

  // Cached reads — keyed by the query, so paging back to a week/month you've
  // already seen is instant. load() refreshes after a create/reschedule/cancel.
  const { data: lessonsRaw = [], mutate } = useApi<Lesson[]>(lessonsQuery);
  const load = () => mutate();

  // Staff for colours + the teacher filter. Management gets the full record;
  // a teacher opting into the whole studio gets a names-only roster; otherwise
  // just themselves. `/staff/me` is fetched separately so we always know the
  // signed-in teacher's own id, which decides what they can edit vs only view.
  //
  // `role` is '' for one render after mount (useRole() is SSR-safe by design —
  // see its own comment). `role !== 'teacher'` was true during that window for
  // every viewer, so a teacher or receptionist's very first render fetched the
  // manager-only '/staff' and '/staff/availability/all' and got a 403 before
  // self-correcting one render later. Wait for role to resolve instead.
  const staffEndpoint = !role ? null : role !== 'teacher' ? '/staff' : wholeStudio ? '/staff/roster' : '/staff/me';
  const { data: staffRaw } = useApi<StaffMember | StaffMember[] | null>(staffEndpoint);
  const staff = Array.isArray(staffRaw) ? staffRaw : staffRaw ? [staffRaw] : [];
  const { data: meRaw } = useApi<StaffMember | null>(role === 'teacher' ? '/staff/me' : null);
  const myStaffId = meRaw?.id ?? null;
  const availabilityEndpoint = !role ? null : role === 'teacher' ? '/staff/me/availability' : '/staff/availability/all';
  const { data: availability = [] } = useApi<Availability[]>(availabilityEndpoint);

  // Apply the teacher/student filters once, up front — everything downstream
  // (day columns, week grid, month cells, counts) reads this narrowed set.
  const lessons = lessonsRaw.filter(l =>
    (!filterTeacherId || (l.teacher?.id ?? '') === filterTeacherId) &&
    (!filterStudentId || (l.student?.id ?? '') === filterStudentId),
  );

  // Student options for the filter, distinct by id, taken from whatever is
  // loaded for the current range (a student with no lessons this week simply
  // isn't offered — there'd be nothing to show).
  const studentOptions = (() => {
    const seen = new Map<string, string>();
    for (const l of lessonsRaw) {
      if (l.student) seen.set(l.student.id, `${l.student.firstName} ${l.student.lastName}`);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  })();
  const showFilters = isManagement || teacherEveryone;

  // Recompute the per-teacher colour map whenever the staff set changes.
  const staffIdsKey = staff.map(s => s.id).join(',');
  useEffect(() => {
    setTeacherColorMap(staff);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffIdsKey]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (viewMenuRef.current && !viewMenuRef.current.contains(e.target as Node)) setViewMenuOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  function goToday() { setAnchorDate(new Date()); if (view === 'month') return; setView('day'); }
  function step(deltaDays: number) {
    const d = new Date(anchorDate);
    d.setDate(d.getDate() + deltaDays);
    setAnchorDate(d);
  }
  // Prev/next honours the current view: a day at a time, a week, or a month.
  function stepPeriod(dir: -1 | 1) {
    if (view === 'month') {
      const d = new Date(anchorDate);
      d.setMonth(d.getMonth() + dir, 1);
      setAnchorDate(d);
    } else {
      step(dir * (view === 'day' ? 1 : 7));
    }
  }

  function openSlot(dayIndex: number, hour: number) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + dayIndex);
    setSlotDate(formatDate(d));
    setSlotTime(`${String(hour).padStart(2, '0')}:00`);
    setShowAdd(true);
  }
  function openSlotForDay(hour: number) {
    setSlotDate(formatDate(anchorDate));
    setSlotTime(`${String(hour).padStart(2, '0')}:00`);
    setShowAdd(true);
  }

  // Group lessons by day index (0=Mon … 6=Sun) — week view
  function dayLessons(dayIndex: number): Lesson[] {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + dayIndex);
    const dayStr = studioDayString(d);
    return lessons.filter(l => studioDayString(l.startsAt) === dayStr);
  }

  // Lessons for a specific teacher on the anchor day — day view
  function teacherDayLessons(teacherId: string | null): Lesson[] {
    const dayStr = studioDayString(anchorDate);
    return lessons.filter(l => studioDayString(l.startsAt) === dayStr && (l.teacher?.id ?? null) === teacherId);
  }

  // Week view: merged "someone is available" bands for a given weekday column.
  function weekAvailabilityBands(dayIndex: number): { top: number; height: number }[] {
    const key = WEEKDAY_KEYS[dayIndex];
    const wins = availability.filter(a => a.weekday === key);
    return mergeWindows(wins)
      .map(([s, e]) => bandBox(s, e))
      .filter((b): b is { top: number; height: number } => b !== null);
  }

  // Day view: a single teacher's availability windows for the anchor day's weekday.
  function teacherAvailabilityBands(teacherId: string | null): { top: number; height: number }[] {
    if (!teacherId) return [];
    // anchorDate.getDay() reads the BROWSER's local weekday, which can disagree
    // with the studio-zone day the rest of the day view is keyed by (formatDate/
    // studioDayString) — showing the wrong day's availability bands for a viewer
    // whose device isn't set to the studio's zone. Derive the weekday from the
    // studio-zone date string instead, same fix as the family booking picker.
    const key = WEEKDAY_KEYS[(new Date(`${formatDate(anchorDate)}T12:00:00Z`).getUTCDay() + 6) % 7];
    return availability
      .filter(a => a.staffId === teacherId && a.weekday === key)
      .map(a => bandBox(hhmmToMin(a.startTime), hhmmToMin(a.endTime)))
      .filter((b): b is { top: number; height: number } => b !== null);
  }

  const weekLabel = `${formatDateLabel(weekStart, { day: 'numeric', month: 'short' })} – ${formatDateLabel(new Date(weekStart.getTime() + 6 * 86400000), { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const dayLabel = formatDateLabel(anchorDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const monthLabel = formatDateLabel(monthGrid.monthStart, { month: 'long', year: 'numeric' });
  const todayStr = formatDate(new Date());
  const anchorStr = formatDate(anchorDate);
  const isAnchorToday = anchorStr === todayStr;

  // teacher columns for day view: assigned teachers + an "Unassigned" bucket if
  // needed. A teacher filter narrows to that one column.
  const dayLessonsToday = lessons.filter(l => studioDayString(l.startsAt) === studioDayString(anchorDate));
  const hasUnassigned = !filterTeacherId && dayLessonsToday.some(l => !l.teacher);
  const teacherCols: { id: string | null; name: string }[] = [
    ...staff
      .filter(s => !filterTeacherId || s.id === filterTeacherId)
      .map(s => ({ id: s.id, name: `${s.firstName} ${s.lastName}` })),
    ...(hasUnassigned ? [{ id: null, name: 'Unassigned' }] : []),
  ];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Clicking a specific grid cell pre-fills that day (slotDate); the
          generic toolbar button has no such intent, so it should default to
          today — not whatever day/week happens to be scrolled into view,
          which could be any date the calendar was last navigated to. */}
      <AddLessonModal
        open={showAdd}
        onClose={() => { setShowAdd(false); setSlotDate(undefined); setSlotTime(undefined); }}
        onCreated={load}
        defaultDate={slotDate ?? todayStr}
        defaultTime={slotTime}
      />
      <NewDefaultLessonModal
        open={showQuickAdd}
        onClose={() => setShowQuickAdd(false)}
        onCreated={load}
        defaultDate={todayStr}
      />
      <LessonDetailModal
        lesson={selectedLesson}
        open={!!selectedLesson}
        onClose={() => setSelectedLesson(null)}
        onUpdated={load}
        readOnly={role === 'teacher' && !!myStaffId && !!selectedLesson?.teacher && selectedLesson.teacher.id !== myStaffId}
        canManage={isManagement}
        staffOptions={staff}
      />
      <AddStudentModal open={showAddStudent} onClose={() => setShowAddStudent(false)} onCreated={load} />
      <AssignStudentsModal open={showAssign} onClose={() => setShowAssign(false)} teachers={staff} onChanged={load} />

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 shrink-0 flex-wrap gap-2 px-4 md:px-7 pt-4 md:pt-7">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => stepPeriod(-1)} className="ui-btn-ghost px-2.5 py-1.5">
            <ChevronLeft size={16} />
          </button>

          {/* Today button + view switcher */}
          <div ref={viewMenuRef} className="relative flex">
            <button onClick={goToday} className="ui-btn-ghost text-sm px-3 py-1.5 rounded-r-none border-r-0">
              Today
            </button>
            <button onClick={() => setViewMenuOpen(o => !o)}
              className="ui-btn-ghost text-sm px-1.5 py-1.5 rounded-l-none">
              <ChevronDown size={13} />
            </button>
            {viewMenuOpen && (
              <div className="absolute top-full left-0 mt-1 w-36 rounded-xl border border-[var(--bd)] bg-white shadow-lg overflow-hidden z-30">
                {(['day', 'week', 'month'] as const).map(v => (
                  <button key={v} onClick={() => { setView(v); setViewMenuOpen(false); }}
                    className="w-full text-left px-3.5 py-2 text-sm capitalize transition-colors hover:bg-[var(--sage-lt)]"
                    style={{ color: view === v ? 'var(--sage-dk)' : 'var(--txt2)', fontWeight: view === v ? 600 : 400 }}>
                    {v} view
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={() => stepPeriod(1)} className="ui-btn-ghost px-2.5 py-1.5">
            <ChevronRight size={16} />
          </button>
          <span className="font-bold text-sm ml-1" style={{ color: 'var(--txt)' }}>
            {view === 'day' ? dayLabel : view === 'month' ? monthLabel : weekLabel}
          </span>
          <span className="text-[11px] font-medium ml-1" style={{ color: 'var(--txt4)' }}>
            · {(view === 'day' ? dayLessonsToday.length : lessons.length)} lesson{(view === 'day' ? dayLessonsToday.length : lessons.length) !== 1 ? 's' : ''}
            {view === 'day' && ' · all teachers'}
          </span>

          {/* Whole-studio toggle — a teacher's opt-in to everyone's schedule.
              Management already sees everyone, so it's only shown to teachers. */}
          {role === 'teacher' && (
            <button
              onClick={() => { setWholeStudio(v => !v); setFilterTeacherId(''); }}
              className="ui-btn-ghost text-xs px-2.5 py-1.5 ml-1"
              style={wholeStudio ? { background: 'var(--sage-lt)', color: 'var(--sage-dk)', borderColor: 'var(--sage-md)' } : undefined}
              title={wholeStudio ? 'Showing every teacher — click for just your own lessons' : 'Showing your lessons — click to see the whole studio'}
            >
              {wholeStudio ? 'Whole studio' : 'My lessons'}
            </button>
          )}

          {/* Teacher + student filters. Applied on the client, so the option
              lists stay complete regardless of what's currently selected. */}
          {showFilters && (
            <>
              <select
                value={filterTeacherId}
                onChange={e => setFilterTeacherId(e.target.value)}
                className="text-xs rounded-lg border px-2 py-1.5 ml-1 bg-white"
                style={{ borderColor: 'var(--bd2)', color: filterTeacherId ? 'var(--txt)' : 'var(--txt4)' }}
              >
                <option value="">All teachers</option>
                {staff.map(s => (
                  <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>
                ))}
              </select>
              <select
                value={filterStudentId}
                onChange={e => setFilterStudentId(e.target.value)}
                className="text-xs rounded-lg border px-2 py-1.5 bg-white"
                style={{ borderColor: 'var(--bd2)', color: filterStudentId ? 'var(--txt)' : 'var(--txt4)' }}
              >
                <option value="">All students</option>
                {studentOptions.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {(filterTeacherId || filterStudentId) && (
                <button onClick={() => { setFilterTeacherId(''); setFilterStudentId(''); }}
                  className="ui-btn-ghost text-xs px-2 py-1.5" title="Clear filters">
                  Clear
                </button>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isManagement && (
            <>
              <button onClick={() => setShowAssign(true)} className="ui-btn-ghost">
                <Users size={15} /> Assign students
              </button>
              <button onClick={() => setShowAddStudent(true)} className="ui-btn-ghost">
                <UserPlus size={15} /> Add student
              </button>
            </>
          )}
          <button onClick={() => setShowAdd(true)} className="ui-btn-primary">+ Add lesson</button>
          <InfoTooltip text="You don't have to add each week's lesson by hand — tick 'Repeat weekly' when booking and the studio creates the whole run of lessons for you. Families are also reminded 24 hours before every lesson automatically." />
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mb-3 shrink-0 flex-wrap px-4 md:px-7">
        <span className="text-[11px] text-[var(--txt4)] font-semibold uppercase tracking-wide">Type:</span>
        <span className="flex items-center gap-1 text-[11px] text-[var(--sage)] font-semibold">
          <span className="w-3 h-3 rounded-sm border-l-2 border-[var(--sage)] bg-[var(--sage-lt)] inline-block" />
          Private (P)
        </span>
        <span className="flex items-center gap-1 text-[11px] text-blue-600 font-semibold">
          <span className="w-3 h-3 rounded-sm border-l-2 border-blue-400 bg-blue-50 inline-block" />
          Group (G)
        </span>
        <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: 'var(--sage-dk)' }}>
          <span className="w-3 h-3 rounded-sm inline-block" style={{ background: hexToRgba('#3D7A55', 0.14), borderLeft: '2px solid rgba(61,122,85,0.4)' }} />
          Available
        </span>
        <span className="w-px h-4 bg-[var(--bd2)] mx-1" />
        <span className="text-[11px] text-[var(--txt4)] font-semibold uppercase tracking-wide">Teacher:</span>
        {staff.map(s => (
          <span key={s.id} className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: teacherColor(s.id) }}>
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: teacherColor(s.id) }} />
            {s.firstName} {s.lastName}
          </span>
        ))}
      </div>

      {/* ── Week view ── */}
      {view === 'week' && (
        <div className="flex-1 min-h-0 overflow-auto bg-white border-t border-[var(--bd)] select-none">
          {/* Sticky header row */}
          <div className="sticky top-0 z-20 bg-white border-b border-[var(--bd)] grid"
            style={{ gridTemplateColumns: '52px repeat(7, 1fr)' }}>
            <div className="border-r border-[var(--bd)] bg-[var(--surf)]" />
            {DAYS.map((day, i) => {
              const d = new Date(weekStart);
              d.setDate(d.getDate() + i);
              const dStr = formatDate(d);
              const isToday = dStr === todayStr;
              const count = dayLessons(i).length;
              return (
                <div key={day}
                  className={`border-r border-[var(--bd)] px-2 py-2.5 text-center bg-[var(--surf)] ${i === 6 ? 'border-r-0' : ''}`}>
                  <div className={`text-[11px] font-bold uppercase tracking-wider ${isToday ? 'text-[var(--sage)]' : 'text-[var(--txt4)]'}`}>{day}</div>
                  {/* dStr (studio-zone) is what dayLessons(i)/isToday are keyed by
                      below — d.getDate() reads the browser-local day-of-month,
                      which can show a different number than the studio-zone day
                      this column's lessons belong to. */}
                  <div className={`text-xl font-bold mt-0.5 ${isToday ? 'text-[var(--sage)]' : 'text-[var(--txt)]'}`}>{Number(dStr.slice(8, 10))}</div>
                  {count > 0 && (
                    <div className="text-[9px] font-bold mt-0.5" style={{ color: 'var(--txt4)' }}>
                      {count} lesson{count !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Body: time column + 7 day columns */}
          <div className="grid" style={{ gridTemplateColumns: '52px repeat(7, 1fr)', minWidth: 700 }}>

            {/* Time gutter */}
            <div className="border-r border-[var(--bd)] relative" style={{ height: TOTAL_H }}>
              {HOURS.map(h => (
                <div key={h} className="absolute w-full flex items-start justify-end pr-2"
                  style={{ top: (h - DAY_START) * PX_PER_HOUR, height: PX_PER_HOUR }}>
                  <span className="text-[10px] font-semibold text-[var(--txt4)] leading-none pt-1 tabular-nums">
                    {String(h).padStart(2, '0')}:00
                  </span>
                </div>
              ))}
            </div>

            {/* Day columns */}
            {DAYS.map((_, di) => {
              const d = new Date(weekStart);
              d.setDate(d.getDate() + di);
              const dStr = formatDate(d);
              const isToday = dStr === todayStr;
              const layout = computeLayout(dayLessons(di));

              return (
                <div key={di}
                  className={`relative border-r border-[var(--bd)] ${di === 6 ? 'border-r-0' : ''} ${isToday ? 'bg-[var(--sage-lt)]/20' : ''}`}
                  style={{ height: TOTAL_H }}>

                  {/* Hour guide lines */}
                  {HOURS.map(h => (
                    <div key={h} className="absolute inset-x-0 border-t border-[var(--bd)]"
                      style={{ top: (h - DAY_START) * PX_PER_HOUR }} />
                  ))}

                  {/* Availability bands — shaded hours a teacher is free to teach */}
                  {weekAvailabilityBands(di).map((b, bi) => (
                    <div key={`av${bi}`} className="absolute inset-x-0 pointer-events-none"
                      style={{ top: b.top, height: b.height, background: hexToRgba('#3D7A55', 0.09), borderLeft: '2px solid rgba(61,122,85,0.35)' }} />
                  ))}

                  {/* Half-hour guide lines (lighter) */}
                  {HOURS.map(h => (
                    <div key={`h${h}`} className="absolute inset-x-0 border-t border-dashed"
                      style={{ top: (h - DAY_START) * PX_PER_HOUR + PX_PER_HOUR / 2, borderColor: '#E2E8F0' }} />
                  ))}

                  {/* Clickable hour slots (behind lessons) */}
                  {HOURS.map(h => (
                    <div key={`slot${h}`}
                      className="absolute inset-x-0 hover:bg-[var(--sage-lt)]/30 transition-colors cursor-pointer group"
                      style={{ top: (h - DAY_START) * PX_PER_HOUR, height: PX_PER_HOUR }}
                      onClick={() => openSlot(di, h)}>
                      <span className="absolute right-1 top-1 text-[9px] text-[var(--sage)] opacity-0 group-hover:opacity-100 font-bold pointer-events-none">+</span>
                    </div>
                  ))}

                  {/* Lesson blocks */}
                  {layout.map(l => (
                    <LessonBlock key={l.id} lesson={l} onClick={() => setSelectedLesson(l)} />
                  ))}

                  {/* "Now" line for today */}
                  {isToday && (() => {
                    const nowMins = (new Date().getHours() - DAY_START) * 60 + new Date().getMinutes();
                    if (nowMins < 0 || nowMins > HOURS.length * 60) return null;
                    return (
                      <div className="absolute inset-x-0 z-20 pointer-events-none flex items-center"
                        style={{ top: (nowMins / 60) * PX_PER_HOUR }}>
                        <div className="w-2 h-2 rounded-full bg-[var(--coral)] ml-0.5 shrink-0" />
                        <div className="flex-1 h-px bg-[var(--coral)]" />
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Day view: all teachers' schedules for the selected day ── */}
      {view === 'day' && (
        <div className="flex-1 min-h-0 overflow-auto bg-white border-t border-[var(--bd)] select-none">
          {teacherCols.length === 0 ? (
            <p className="p-8 text-center text-sm" style={{ color: 'var(--txt4)' }}>No teaching staff found.</p>
          ) : (
            <>
              {/* Sticky header row */}
              <div className="sticky top-0 z-20 bg-white border-b border-[var(--bd)] grid"
                style={{ gridTemplateColumns: `52px repeat(${teacherCols.length}, minmax(140px, 1fr))` }}>
                <div className="border-r border-[var(--bd)] bg-[var(--surf)]" />
                {teacherCols.map(col => {
                  const count = teacherDayLessons(col.id).length;
                  return (
                    <div key={col.id ?? 'unassigned'}
                      className="border-r border-[var(--bd)] last:border-r-0 px-2 py-2.5 text-center bg-[var(--surf)]">
                      <div className="text-[12px] font-bold truncate" style={{ color: 'var(--txt)' }}>{col.name}</div>
                      {count > 0 && (
                        <div className="text-[9px] font-bold mt-0.5" style={{ color: 'var(--txt4)' }}>
                          {count} lesson{count !== 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Body */}
              <div className="grid" style={{ gridTemplateColumns: `52px repeat(${teacherCols.length}, minmax(140px, 1fr))`, minWidth: 700 }}>
                {/* Time gutter */}
                <div className="border-r border-[var(--bd)] relative" style={{ height: TOTAL_H }}>
                  {HOURS.map(h => (
                    <div key={h} className="absolute w-full flex items-start justify-end pr-2"
                      style={{ top: (h - DAY_START) * PX_PER_HOUR, height: PX_PER_HOUR }}>
                      <span className="text-[10px] font-semibold text-[var(--txt4)] leading-none pt-1 tabular-nums">
                        {String(h).padStart(2, '0')}:00
                      </span>
                    </div>
                  ))}
                </div>

                {/* Teacher columns */}
                {teacherCols.map((col, ci) => {
                  const layout = computeLayout(teacherDayLessons(col.id));
                  return (
                    <div key={col.id ?? 'unassigned'}
                      className={`relative border-r border-[var(--bd)] ${ci === teacherCols.length - 1 ? 'border-r-0' : ''} ${isAnchorToday ? 'bg-[var(--sage-lt)]/20' : ''}`}
                      style={{ height: TOTAL_H }}>

                      {HOURS.map(h => (
                        <div key={h} className="absolute inset-x-0 border-t border-[var(--bd)]"
                          style={{ top: (h - DAY_START) * PX_PER_HOUR }} />
                      ))}
                      {HOURS.map(h => (
                        <div key={`h${h}`} className="absolute inset-x-0 border-t border-dashed"
                          style={{ top: (h - DAY_START) * PX_PER_HOUR + PX_PER_HOUR / 2, borderColor: '#E2E8F0' }} />
                      ))}
                      {/* Availability bands — this teacher's free-to-teach hours, in their colour */}
                      {teacherAvailabilityBands(col.id).map((b, bi) => (
                        <div key={`av${bi}`} className="absolute inset-x-0 pointer-events-none"
                          style={{ top: b.top, height: b.height, background: hexToRgba(teacherColor(col.id), 0.1), borderLeft: `2px solid ${hexToRgba(teacherColor(col.id), 0.4)}` }}>
                          <span className="absolute left-1.5 top-1 text-[8px] font-bold uppercase tracking-wide pointer-events-none"
                            style={{ color: teacherColor(col.id), opacity: 0.55 }}>Available</span>
                        </div>
                      ))}

                      {HOURS.map(h => (
                        <div key={`slot${h}`}
                          className="absolute inset-x-0 hover:bg-[var(--sage-lt)]/30 transition-colors cursor-pointer group"
                          style={{ top: (h - DAY_START) * PX_PER_HOUR, height: PX_PER_HOUR }}
                          onClick={() => openSlotForDay(h)}>
                          <span className="absolute right-1 top-1 text-[9px] text-[var(--sage)] opacity-0 group-hover:opacity-100 font-bold pointer-events-none">+</span>
                        </div>
                      ))}

                      {layout.map(l => (
                        <LessonBlock key={l.id} lesson={l} onClick={() => setSelectedLesson(l)} />
                      ))}

                      {isAnchorToday && (() => {
                        const nowMins = (new Date().getHours() - DAY_START) * 60 + new Date().getMinutes();
                        if (nowMins < 0 || nowMins > HOURS.length * 60) return null;
                        return (
                          <div className="absolute inset-x-0 z-20 pointer-events-none flex items-center"
                            style={{ top: (nowMins / 60) * PX_PER_HOUR }}>
                            <div className="w-2 h-2 rounded-full bg-[var(--coral)] ml-0.5 shrink-0" />
                            <div className="flex-1 h-px bg-[var(--coral)]" />
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Month view: a traditional 6-week grid, chips per lesson ── */}
      {view === 'month' && (
        <div className="flex-1 min-h-0 overflow-auto bg-white border-t border-[var(--bd)]">
          {/* Weekday header */}
          <div className="sticky top-0 z-10 grid bg-[var(--surf)] border-b border-[var(--bd)]"
            style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {DAYS.map(d => (
              <div key={d} className="px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wider border-r border-[var(--bd)] last:border-r-0"
                style={{ color: 'var(--txt4)' }}>{d}</div>
            ))}
          </div>

          {/* 6 rows × 7 days */}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(7, 1fr)', minWidth: 700 }}>
            {Array.from({ length: 42 }, (_, i) => {
              const d = new Date(monthGrid.gridStart);
              d.setDate(d.getDate() + i);
              const dStr = formatDate(d);
              const inMonth = d.getMonth() === monthGrid.monthStart.getMonth();
              const isToday = dStr === todayStr;
              const dayStr = studioDayString(d);
              const dayList = lessons
                .filter(l => studioDayString(l.startsAt) === dayStr)
                .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
              const shown = dayList.slice(0, 4);
              const extra = dayList.length - shown.length;
              return (
                <button
                  key={i}
                  ref={isToday ? todayCellRef : undefined}
                  onClick={() => { setAnchorDate(d); setView('day'); }}
                  className="text-left border-r border-b border-[var(--bd)] last:border-r-0 p-1.5 align-top transition-colors hover:bg-[var(--sage-lt)]/20"
                  style={{ minHeight: 108, background: inMonth ? '#fff' : 'var(--surf)' }}
                  title="Open this day"
                >
                  <div className="flex items-center justify-between mb-1">
                    {/* dayStr (studio-zone) is what dayList is filtered by —
                        d.getDate() reads the browser-local day-of-month, which
                        can show a different number than the cell's actual data. */}
                    <span className={`text-xs font-bold ${isToday ? 'text-white bg-[var(--sage)] rounded-full w-5 h-5 flex items-center justify-center' : inMonth ? 'text-[var(--txt2)]' : 'text-[var(--txt4)]'}`}>
                      {Number(dayStr.slice(8, 10))}
                    </span>
                    {dayList.length > 0 && (
                      <span className="text-[9px] font-bold" style={{ color: 'var(--txt4)' }}>{dayList.length}</span>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    {shown.map(l => {
                      const c = teacherColor(l.teacher?.id);
                      const cancelled = l.status.startsWith('cancelled');
                      const landmark = STATUS_LANDMARK[l.status];
                      return (
                        <div
                          key={l.id}
                          onClick={(e) => { e.stopPropagation(); setSelectedLesson(l); }}
                          className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium truncate cursor-pointer hover:brightness-95"
                          style={{
                            background: hexToRgba(c, 0.14),
                            border: `1px solid ${hexToRgba(c, 0.5)}`,
                            color: 'var(--txt2)',
                            textDecoration: cancelled ? 'line-through' : undefined,
                            opacity: cancelled ? 0.6 : 1,
                          }}
                          title={`${fmtTime(l.startsAt)} ${l.student?.firstName ?? ''} ${l.student?.lastName ?? ''}${l.teacher ? ' · ' + l.teacher.firstName + ' ' + l.teacher.lastName : ''}${l.enrollment?.instrument ? ' · ' + l.enrollment.instrument : ''}`}
                        >
                          <span className="tabular-nums shrink-0" style={{ color: c }}>{fmtTime(l.startsAt)}</span>
                          <span className="truncate flex-1">{l.student?.firstName} {l.student?.lastName?.[0] ?? ''}</span>
                          {l.paymentStatus === 'paid' && <PoundSterling size={8} className="shrink-0" style={{ color: PAID_COLOR }} />}
                          {l.paymentStatus === 'unpaid' && <PoundSterling size={8} className="shrink-0" style={{ color: UNPAID_COLOR }} />}
                          {landmark && <landmark.Icon size={8} className="shrink-0" style={{ color: landmark.color }} />}
                        </div>
                      );
                    })}
                    {extra > 0 && (
                      <div className="text-[10px] font-semibold pl-1" style={{ color: 'var(--sage)' }}>+{extra} more</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
