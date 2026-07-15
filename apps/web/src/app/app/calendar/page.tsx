'use client';

import { useState, useEffect, useRef, FormEvent } from 'react';
import { apiFetch } from '@/lib/api';
import { fmtTime, fmtTimeEnd, fmtDate, studioMinutesFromMidnight, studioDayString } from '@/lib/datetime';
import { Modal } from '@/components/modal';
import { Badge } from '@/components/badge';
import { SearchableSelect } from '@/components/searchable-select';
import { InstrumentIcon } from '@/components/instrument-icons';
import { InfoTooltip } from '@/components/info-tooltip';
import { AddStudentModal } from '@/components/add-student-modal';
import { AssignStudentsModal } from '@/components/assign-students-modal';
import { PRIVATE_INSTRUMENTS, GROUP_INSTRUMENTS, lessonRate } from '@music-life/types';
import { ChevronDown, ChevronLeft, ChevronRight, UserPlus, Users } from 'lucide-react';

interface Lesson {
  id: string; startsAt: string; duration: number; status: string; notes: string | null;
  student: { id: string; firstName: string; lastName: string } | null;
  teacher: { id: string; firstName: string; lastName: string } | null;
  room: { id: string; name: string } | null;
  attendance: { status: string } | null;
  enrollment: { instrument: string; lessonType: string; groupName?: string | null } | null;
}
interface StaffMember { id: string; firstName: string; lastName: string; }
interface Student { id: string; firstName: string; lastName: string; }
interface Room { id: string; name: string; }
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
function formatDate(d: Date) { return d.toISOString().split('T')[0]!; }

// Position on the day grid using the lesson's wall-clock time in the studio zone
// (so a 16:00 lesson sits at the 16:00 row for every viewer, not the browser's zone).
function minutesFromDayStart(iso: string): number {
  return studioMinutesFromMidnight(iso) - DAY_START * 60;
}

// ─── Overlap-aware column layout ──────────────────────────────────────────────
type LessonLayout = Lesson & { col: number; totalCols: number };

function computeLayout(dayLessons: Lesson[]): LessonLayout[] {
  const sorted = [...dayLessons].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
  );

  // Greedy column assignment
  const colEnds: number[] = []; // colEnds[i] = earliest ms when column i is free
  const assignment = new Map<string, number>();

  for (const l of sorted) {
    const start = new Date(l.startsAt).getTime();
    const end   = start + l.duration * 60000;
    let col = colEnds.findIndex(e => e <= start);
    if (col === -1) { col = colEnds.length; colEnds.push(end); }
    else { colEnds[col] = end; }
    assignment.set(l.id, col);
  }

  // For each lesson: totalCols = max column index among all overlapping lessons + 1
  return sorted.map(l => {
    const start = new Date(l.startsAt).getTime();
    const end   = start + l.duration * 60000;
    let maxCol = assignment.get(l.id)!;
    for (const other of sorted) {
      const os = new Date(other.startsAt).getTime();
      const oe = os + other.duration * 60000;
      if (os < end && oe > start) maxCol = Math.max(maxCol, assignment.get(other.id)!);
    }
    return { ...l, col: assignment.get(l.id)!, totalCols: maxCol + 1 };
  });
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

// ─── Status colours (bg/border/text) — scheduled (upcoming) vs completed (done) ───────
const STATUS_STYLE: Record<string, { bg: string; border: string; text: string }> = {
  scheduled:           { bg: '#EBF4FF', border: '#90BEF0', text: '#2B6CB0' },
  completed:           { bg: '#F0FFF4', border: '#68D391', text: '#22543D' },
  cancelled_no_makeup: { bg: '#FFF5F5', border: '#FC8181', text: '#9B2C2C' },
  cancelled_no_pay:    { bg: '#FFFAF0', border: '#F6AD55', text: '#7B341E' },
  cancelled_teacher:   { bg: '#FFFFF0', border: '#F6E05E', text: '#744210' },
  cancelled_makeup:    { bg: '#F5F0FF', border: '#C4B5FD', text: '#5B3F9E' },
  makeup:              { bg: '#F5F0FF', border: '#C4B5FD', text: '#5B3F9E' },
};

// ─── Lesson block ─────────────────────────────────────────────────────────────
function LessonBlock({ lesson, onClick }: { lesson: LessonLayout; onClick: () => void }) {
  const top    = (minutesFromDayStart(lesson.startsAt) / 60) * PX_PER_HOUR;
  const height = Math.max((lesson.duration / 60) * PX_PER_HOUR - 2, 22);
  const left   = `${(lesson.col / lesson.totalCols) * 100}%`;
  const width  = `calc(${(1 / lesson.totalCols) * 100}% - 3px)`;

  const style   = STATUS_STYLE[lesson.status] ?? STATUS_STYLE.scheduled!;
  const instr   = lesson.enrollment?.instrument;
  const isGrp   = lesson.enrollment?.lessonType === 'group';
  const tColor  = teacherColor(lesson.teacher?.id);
  const iColor  = instrColor(instr);
  const tall    = height >= 52;
  const xtall   = height >= 72;

  return (
    <button
      onClick={onClick}
      style={{ top, height, left, width, background: style.bg, borderTopColor: style.border, borderRightColor: style.border, borderBottomColor: style.border, borderLeftColor: tColor, borderLeftWidth: 3 }}
      className="absolute rounded-r-lg border cursor-pointer text-left px-1.5 py-1 overflow-hidden transition-all hover:brightness-95 hover:shadow-md group z-10"
    >
      {/* Time range — always shown */}
      <p className="text-[9px] font-bold leading-none mb-0.5 tabular-nums"
        style={{ color: style.text, opacity: 0.7 }}>
        {fmtTime(lesson.startsAt)}–{fmtTimeEnd(lesson.startsAt, lesson.duration)}
      </p>

      {/* Student name */}
      <p className="text-[11px] font-bold leading-tight truncate" style={{ color: style.text }}>
        {lesson.student?.firstName} {lesson.student?.lastName}
      </p>

      {/* Instrument + type badge */}
      {tall && instr && (
        <p className="flex items-center gap-1 mt-0.5">
          <span className="shrink-0" style={{ color: iColor }}><InstrumentIcon name={instr} size={11} /></span>
          <span className="text-[10px] font-semibold capitalize truncate" style={{ color: iColor }}>
            {instr}
          </span>
          <span className={`text-[8px] font-bold px-1 py-px rounded-full leading-none shrink-0
            ${isGrp ? 'bg-blue-100 text-blue-700' : 'bg-[var(--sage-lt)] text-[var(--sage)]'}`}>
            {isGrp ? 'G' : 'P'}
          </span>
        </p>
      )}

      {/* Group name */}
      {xtall && isGrp && lesson.enrollment?.groupName && (
        <p className="text-[10px] italic leading-tight truncate" style={{ color: style.text, opacity: 0.65 }}>
          {lesson.enrollment.groupName}
        </p>
      )}

      {/* Teacher name */}
      {xtall && lesson.teacher && (
        <p className="flex items-center gap-1 mt-px">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: tColor }} />
          <span className="text-[10px] leading-tight truncate" style={{ color: style.text, opacity: 0.65 }}>
            {lesson.teacher.firstName} {lesson.teacher.lastName}
          </span>
        </p>
      )}
    </button>
  );
}

// ─── Add lesson modal ─────────────────────────────────────────────────────────
function AddLessonModal({ open, onClose, onCreated, defaultDate, defaultTime }: {
  open: boolean; onClose: () => void; onCreated: () => void;
  defaultDate?: string; defaultTime?: string;
}) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [studentsList, setStudentsList] = useState<Student[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [studentId, setStudentId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [lessonType, setLessonType] = useState<'private' | 'group'>('private');
  const [instrument, setInstrument] = useState('');
  const [groupName, setGroupName] = useState('');
  const [duration, setDuration] = useState('60');
  const [repeat, setRepeat] = useState(false);
  const [repeatWeeks, setRepeatWeeks] = useState('12');
  const [result, setResult] = useState<{ created: number; through: string } | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [isTeacher, setIsTeacher] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  useEffect(() => {
    if (!open) return;
    setStudentId(''); setTeacherId(''); setRoomId(''); setDuration('60');
    setLessonType('private'); setInstrument(''); setGroupName('');
    setRepeat(false); setRepeatWeeks('12'); setResult(null);
    const t = tok();
    const role = getRoleFromToken(t);
    const teacherSelf = role === 'teacher';
    setIsTeacher(teacherSelf);
    Promise.all([
      teacherSelf
        ? apiFetch<StaffMember | null>('/staff/me', { token: t }).catch(() => null).then(me => me ? [me] : [])
        : apiFetch<StaffMember[]>('/staff', { token: t }).catch(() => []),
      apiFetch<Student[]>('/students', { token: t }).catch(() => []),
      apiFetch<Room[]>('/rooms', { token: t }).catch(() => []),
    ]).then(([s, st, r]) => {
      setStaff(s);
      setStudentsList(st); setRooms(r);
      if (teacherSelf && s[0]) setTeacherId(s[0].id);
    });
  }, [open]);

  const instrumentOptions = lessonType === 'private' ? PRIVATE_INSTRUMENTS : GROUP_INSTRUMENTS;
  const durationOptions = lessonType === 'private'
    ? [{ value: '30', label: '30 min' }, { value: '45', label: '45 min' }, { value: '60', label: '60 min' }]
    : [{ value: '60', label: '60 min' }];

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!instrument) { setError('Please select an instrument or group'); return; }
    setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    const t = tok();
    try {
      // Find or create a matching enrollment for this student so the lesson carries instrument + type (+ group name).
      const detail = await apiFetch<StudentDetail>(`/students/${studentId}`, { token: t });
      let enrollmentId = detail.enrollments.find(
        en => en.instrument === instrument && en.lessonType === lessonType && en.status !== 'withdrawn'
          && (lessonType !== 'group' || (en.groupName ?? '') === groupName.trim()),
      )?.id;

      if (!enrollmentId) {
        const created = await apiFetch<{ id: string }>(`/students/${studentId}/enrollments`, {
          method: 'POST', token: t, body: JSON.stringify({
            instrument, lessonType, duration: parseInt(duration) || 60,
            groupName: lessonType === 'group' && groupName.trim() ? groupName.trim() : undefined,
            teacherId: teacherId || undefined,
            rate: lessonRate(lessonType, parseInt(duration) || 60),
            autoRenew: false, status: 'active',
          }),
        });
        enrollmentId = created.id;
      }

      const date = f.get('date') as string;
      const time = f.get('time') as string;

      if (repeat) {
        // Set the enrollment's weekly schedule (weekday derived from the picked
        // date), then materialise the series from that date so every week appears
        // on the calendar at once.
        const weekday = WEEKDAY_KEYS[(new Date(`${date}T12:00:00`).getDay() + 6) % 7];
        await apiFetch(`/enrollments/${enrollmentId}`, {
          method: 'PATCH', token: t, body: JSON.stringify({ scheduleRule: { weekday, startTime: time } }),
        });
        const r = await apiFetch<{ created: number; through: string }>('/lessons/recurring', {
          method: 'POST', token: t,
          body: JSON.stringify({ enrollmentId, weeks: parseInt(repeatWeeks) || 12, startFrom: date }),
        });
        onCreated();
        setResult({ created: r.created, through: r.through });
      } else {
        await apiFetch('/lessons', { method: 'POST', token: t, body: JSON.stringify({
          studentId, teacherId: teacherId || undefined,
          roomId: roomId || undefined,
          enrollmentId,
          startsAt: `${date}T${time}:00`,
          duration: parseInt(duration) || 60,
          notes: f.get('notes') || undefined,
        })});
        onCreated(); onClose();
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add lesson">
      {error && (
        <div className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}
      {result ? (
        <div className="space-y-4">
          <div className="rounded-xl px-4 py-4 text-sm"
            style={{ background: 'var(--sage-lt)', color: 'var(--sage-dk)', border: '1px solid var(--sage)' }}>
            <p className="font-bold text-base mb-1">Weekly lessons booked ✓</p>
            {result.created > 0 ? (
              <p>Added <strong>{result.created}</strong> weekly lesson{result.created !== 1 ? 's' : ''} through{' '}
                {new Date(result.through).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.</p>
            ) : (
              <p>No new lessons were booked — they may already exist for this weekly slot.</p>
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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ui-label">Duration</label>
            <SearchableSelect options={durationOptions} value={duration} onChange={setDuration} disabled={lessonType === 'group'} />
          </div>
          <div>
            <label className="ui-label">Room</label>
            <SearchableSelect
              options={rooms.map(r => ({ value: r.id, label: r.name }))}
              value={roomId} onChange={setRoomId} emptyLabel="No room"
            />
          </div>
        </div>
        {!repeat && (
          <div>
            <label className="ui-label">Notes</label>
            <textarea name="notes" rows={2} className="ui-input" style={{ resize: 'vertical' }} />
          </div>
        )}

        {/* Repeat weekly — turns this into a recurring weekly booking */}
        <div className="rounded-xl border p-3" style={{ borderColor: repeat ? 'var(--sage)' : 'var(--bd)', background: repeat ? 'var(--sage-lt)' : 'transparent' }}>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={repeat} onChange={e => setRepeat(e.target.checked)}
              className="h-4 w-4 rounded" style={{ accentColor: 'var(--sage)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>Repeat weekly</span>
          </label>
          {repeat && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-sm" style={{ color: 'var(--txt3)' }}>Book the same slot for the next</span>
              <div className="w-24">
                <SearchableSelect
                  options={[4, 8, 12, 16, 24, 36, 52].map(w => ({ value: String(w), label: `${w} weeks` }))}
                  value={repeatWeeks} onChange={setRepeatWeeks}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving} className="ui-btn-primary">
            {saving ? 'Saving…' : repeat ? 'Book weekly lessons' : 'Add lesson'}
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
  { status: 'present',           label: 'Present' },
  { status: 'absent_makeup',     label: 'Makeup (≥24h)' },
  { status: 'absent_no_makeup',  label: 'No makeup (<24h)' },
  { status: 'absent_no_pay',     label: 'No class, no pay' },
  { status: 'cancelled_teacher', label: 'Teacher cancel' },
] as const;
const GROUP_ATTENDANCE = [
  { status: 'present',           label: 'Present' },
  { status: 'absent_no_pay',     label: 'Absent' },
  { status: 'cancelled_teacher', label: 'Cancelled' },
] as const;

function LessonDetailModal({ lesson, open, onClose, onUpdated }: {
  lesson: Lesson | null; open: boolean; onClose: () => void; onUpdated: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [actionError, setActionError] = useState('');
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  useEffect(() => {
    setShowReschedule(false); setActionError('');
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
          <div className="flex justify-between">
            <span style={{ color: 'var(--txt3)' }}>Teacher</span>
            <span className="font-medium">{lesson.teacher ? `${lesson.teacher.firstName} ${lesson.teacher.lastName}` : '—'}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--txt3)' }}>Room</span>
            <span className="font-medium">{lesson.room?.name ?? '—'}</span>
          </div>
          <div className="flex justify-between items-center">
            <span style={{ color: 'var(--txt3)' }}>Status</span>
            <Badge variant={lesson.status}>{lesson.status.replace(/_/g, ' ')}</Badge>
          </div>
          {lesson.attendance && (
            <div className="flex justify-between items-center">
              <span style={{ color: 'var(--txt3)' }}>Attendance</span>
              <Badge variant={lesson.attendance.status}>{lesson.attendance.status.replace(/_/g, ' ')}</Badge>
            </div>
          )}
        </div>

        {lesson.status === 'scheduled' && (
          <div>
            <p className="text-sm font-semibold mb-2" style={{ color: 'var(--txt2)' }}>Mark attendance</p>
            <div className="grid grid-cols-2 gap-2">
              {actions.map(a => (
                <button key={a.status} onClick={() => markAttendance(a.status)} disabled={saving}
                  className="text-left text-sm rounded-[9px] px-3 py-2 font-medium transition-colors disabled:opacity-50"
                  style={{ border: '1.5px solid var(--bd2)', color: 'var(--txt2)', background: '#fff' }}
                  onMouseOver={e => (e.currentTarget.style.background = 'var(--surf)')}
                  onMouseOut={e => (e.currentTarget.style.background = '#fff')}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {actionError && (
          <div className="text-sm rounded-xl px-4 py-3"
            style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
            {actionError}
          </div>
        )}

        {lesson.status === 'scheduled' && (
          <div>
            {showReschedule ? (
              <div className="rounded-xl p-3.5 space-y-3" style={{ background: 'var(--surf)', border: '1px solid var(--bd)' }}>
                <p className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--txt2)' }}>
                  Reschedule to
                  <InfoTooltip text="We'll check the new time is free and inside the teacher's working hours — so you can't accidentally double-book a teacher or room, or pick a time they're unavailable." />
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

        {lesson.status.startsWith('cancelled_') && !lesson.attendance && (
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
  const [view, setView] = useState<'week' | 'day'>('week');
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [role, setRole] = useState('');
  const [slotDate, setSlotDate] = useState<string | undefined>();
  const [slotTime, setSlotTime] = useState<string | undefined>();
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  const weekStart = getWeekStart(anchorDate);

  function load() {
    apiFetch<Lesson[]>(`/lessons?weekStart=${formatDate(weekStart)}`, { token: tok() })
      .then(setLessons).catch(() => {});
  }
  useEffect(() => { load(); }, [weekStart.getTime()]);
  useEffect(() => {
    const t = tok();
    const role = getRoleFromToken(t);
    setRole(role);
    if (role === 'teacher') {
      apiFetch<StaffMember | null>('/staff/me', { token: t }).then(me => {
        const list = me ? [me] : [];
        setStaff(list); setTeacherColorMap(list);
      }).catch(() => {});
      // A teacher sees only their own availability windows.
      apiFetch<Availability[]>('/staff/me/availability', { token: t }).then(setAvailability).catch(() => {});
    } else {
      apiFetch<StaffMember[]>('/staff', { token: t }).then(list => {
        setStaff(list); setTeacherColorMap(list);
      }).catch(() => {});
      // Admin/manager see every teacher's availability, coloured per teacher.
      apiFetch<Availability[]>('/staff/availability/all', { token: t }).then(setAvailability).catch(() => {});
    }
  }, []);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (viewMenuRef.current && !viewMenuRef.current.contains(e.target as Node)) setViewMenuOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  function goToday() { setAnchorDate(new Date()); setView('day'); }
  function step(deltaDays: number) {
    const d = new Date(anchorDate);
    d.setDate(d.getDate() + deltaDays);
    setAnchorDate(d);
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
    const key = WEEKDAY_KEYS[(anchorDate.getDay() + 6) % 7];
    return availability
      .filter(a => a.staffId === teacherId && a.weekday === key)
      .map(a => bandBox(hhmmToMin(a.startTime), hhmmToMin(a.endTime)))
      .filter((b): b is { top: number; height: number } => b !== null);
  }

  const weekLabel = `${weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(weekStart.getTime() + 6 * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const dayLabel = anchorDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const todayStr = formatDate(new Date());
  const anchorStr = formatDate(anchorDate);
  const isAnchorToday = anchorStr === todayStr;

  // teacher columns for day view: assigned teachers + an "Unassigned" bucket if needed
  const dayLessonsToday = lessons.filter(l => studioDayString(l.startsAt) === studioDayString(anchorDate));
  const hasUnassigned = dayLessonsToday.some(l => !l.teacher);
  const teacherCols: { id: string | null; name: string }[] = [
    ...staff.map(s => ({ id: s.id, name: `${s.firstName} ${s.lastName}` })),
    ...(hasUnassigned ? [{ id: null, name: 'Unassigned' }] : []),
  ];

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 96px)' }}>
      <AddLessonModal
        open={showAdd}
        onClose={() => { setShowAdd(false); setSlotDate(undefined); setSlotTime(undefined); }}
        onCreated={load}
        defaultDate={slotDate ?? (view === 'day' ? anchorStr : formatDate(weekStart))}
        defaultTime={slotTime}
      />
      <NewDefaultLessonModal
        open={showQuickAdd}
        onClose={() => setShowQuickAdd(false)}
        onCreated={load}
        defaultDate={view === 'day' ? anchorStr : formatDate(weekStart)}
      />
      <LessonDetailModal lesson={selectedLesson} open={!!selectedLesson} onClose={() => setSelectedLesson(null)} onUpdated={load} />
      <AddStudentModal open={showAddStudent} onClose={() => setShowAddStudent(false)} onCreated={load} />
      <AssignStudentsModal open={showAssign} onClose={() => setShowAssign(false)} teachers={staff} onChanged={load} />

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button onClick={() => step(view === 'day' ? -1 : -7)} className="ui-btn-ghost px-2.5 py-1.5">
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
                {(['day', 'week'] as const).map(v => (
                  <button key={v} onClick={() => { setView(v); setViewMenuOpen(false); }}
                    className="w-full text-left px-3.5 py-2 text-sm capitalize transition-colors hover:bg-[var(--sage-lt)]"
                    style={{ color: view === v ? 'var(--sage-dk)' : 'var(--txt2)', fontWeight: view === v ? 600 : 400 }}>
                    {v} view
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={() => step(view === 'day' ? 1 : 7)} className="ui-btn-ghost px-2.5 py-1.5">
            <ChevronRight size={16} />
          </button>
          <span className="font-bold text-sm ml-1" style={{ color: 'var(--txt)' }}>
            {view === 'day' ? dayLabel : weekLabel}
          </span>
          <span className="text-[11px] font-medium ml-1" style={{ color: 'var(--txt4)' }}>
            · {(view === 'day' ? dayLessonsToday.length : lessons.length)} lesson{(view === 'day' ? dayLessonsToday.length : lessons.length) !== 1 ? 's' : ''}
            {view === 'day' && ' · all teachers'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {role !== 'teacher' && (
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
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mb-3 shrink-0 flex-wrap">
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
        <div className="flex-1 overflow-auto bg-white rounded-2xl border border-[var(--bd)] select-none">
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
                  <div className={`text-xl font-bold mt-0.5 ${isToday ? 'text-[var(--sage)]' : 'text-[var(--txt)]'}`}>{d.getDate()}</div>
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
        <div className="flex-1 overflow-auto bg-white rounded-2xl border border-[var(--bd)] select-none">
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
    </div>
  );
}
