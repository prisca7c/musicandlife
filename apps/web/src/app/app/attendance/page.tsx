'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { fmtTime } from '@/lib/datetime';
import { PageHeader } from '@/components/page-header';
import { InfoTooltip } from '@/components/info-tooltip';
import { Badge } from '@/components/badge';
import { LoadState } from '@/components/load-state';
import { AutomatedHint } from '@/components/automated-hint';
import { Check, X, AlertTriangle, Calendar, RefreshCw, Search, PoundSterling } from 'lucide-react';

// Roles allowed to take money at the front desk. Teachers mark attendance too,
// but they don't handle payments — so the "paid at the lesson" control is theirs
// to see, not press.
const CAN_TAKE_PAYMENT = ['receptionist', 'manager', 'admin', 'system_admin'];
function roleFromToken(token?: string): string {
  try { return token ? (JSON.parse(atob(token.split('.')[1]!)).role ?? '') : ''; }
  catch { return ''; }
}

interface Lesson {
  id: string; startsAt: string; duration: number; status: string;
  student: { id: string; firstName: string; lastName: string } | null;
  teacher: { id: string; firstName: string; lastName: string } | null;
  attendance: { status: string } | null;
  enrollment: { instrument: string; lessonType: string } | null;
}

type AttendanceStatus = 'present' | 'absent_makeup' | 'absent_no_makeup' | 'absent_no_pay' | 'cancelled_teacher';

const PRIVATE_ACTIONS: { status: AttendanceStatus; label: string; color: string; bg: string; border: string }[] = [
  { status: 'present',          label: 'Present',           color: 'text-[var(--sage-dk)]',  bg: 'bg-[var(--sage-lt)]',  border: 'border-[var(--sage-md)]' },
  // Labels say what happens to the money, because that is what these buttons do.
  { status: 'absent_makeup',    label: 'Cancelled ≥24h — no charge, rebook',  color: 'text-[var(--amber)]',    bg: 'bg-[var(--amber-lt)]', border: 'border-[var(--amber-md)]' },
  { status: 'absent_no_makeup', label: 'Cancelled <24h — charged',            color: 'text-[var(--coral)]',    bg: 'bg-[var(--coral-lt)]', border: 'border-[var(--coral)]' },
  { status: 'absent_no_pay',    label: 'Absent — no charge',                  color: 'text-[var(--sky)]',      bg: 'bg-[var(--sky-lt)]',   border: 'border-[var(--sky-md)]' },
  { status: 'cancelled_teacher',label: 'Teacher cancel',     color: 'text-[var(--txt3)]',     bg: 'bg-[var(--surf)]',     border: 'border-[var(--bd2)]' },
];

const GROUP_ACTIONS: { status: AttendanceStatus; label: string; color: string; bg: string; border: string }[] = [
  { status: 'present',          label: 'Present',        color: 'text-[var(--sage-dk)]', bg: 'bg-[var(--sage-lt)]', border: 'border-[var(--sage-md)]' },
  { status: 'absent_no_pay',    label: 'Absent',         color: 'text-[var(--sky)]',     bg: 'bg-[var(--sky-lt)]',  border: 'border-[var(--sky-md)]' },
  { status: 'cancelled_teacher',label: 'Cancelled',      color: 'text-[var(--txt3)]',    bg: 'bg-[var(--surf)]',    border: 'border-[var(--bd2)]' },
];

// One glyph per attendance state for the month grid. Deliberately letters, not
// colour alone — a red and an amber square are indistinguishable to a good
// share of people, and this grid is the studio's record of who turned up.
const MONTH_CELL: Record<string, { ch: string; bg: string; fg: string; label: string }> = {
  present:           { ch: 'P', bg: 'var(--sage-lt)',  fg: 'var(--sage-dk)', label: 'Present' },
  absent_makeup:     { ch: 'M', bg: 'var(--amber-lt)', fg: 'var(--amber)',   label: 'Cancelled in good time — no charge, to be rebooked' },
  absent_no_makeup:  { ch: 'A', bg: 'var(--coral-lt)', fg: 'var(--coral)',   label: 'Cancelled late — charged, teacher paid' },
  absent_no_pay:     { ch: 'N', bg: 'var(--sky-lt)',   fg: 'var(--sky)',     label: 'Absent — no charge' },
  cancelled_teacher: { ch: 'T', bg: 'var(--surf)',     fg: 'var(--txt3)',    label: 'Cancelled by teacher' },
  unmarked:          { ch: '·', bg: 'transparent',     fg: 'var(--txt4)',    label: 'Lesson scheduled, not yet marked' },
};


/**
 * One row per student, one column per day of the month.
 *
 * Read-only on purpose. Marking happens in the day view, where the full set of
 * options and their money consequences are spelled out — a month grid tempts
 * you to click quickly across a row, and "absent, late notice" charges a family
 * while "absent, no charge" doesn't.
 */
function MonthGrid({
  lessons, daysInMonth, monthLabel, error, loading, onRetry,
}: {
  lessons: Lesson[]; daysInMonth: number; monthLabel: string;
  error?: unknown; loading?: boolean; onRetry?: () => void;
}) {
  if (error || loading) {
    return (
      <div className="bg-white rounded-2xl border border-[var(--bd)] p-6">
        <LoadState error={error} loading={loading} onRetry={onRetry} failedLabel="Couldn't load the month." />
      </div>
    );
  }
  if (lessons.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-[var(--bd)] px-6 py-12 text-center">
        <p className="text-[var(--txt3)]">No lessons in {monthLabel}.</p>
      </div>
    );
  }

  // student -> day-of-month -> the marks on that day (a student can have two
  // lessons in a day; both are shown rather than one silently winning).
  const rows = new Map<string, { name: string; days: Map<number, string[]> }>();
  for (const l of lessons) {
    const sid = l.student?.id ?? 'unknown';
    const name = l.student ? `${l.student.firstName} ${l.student.lastName}` : 'Unknown student';
    if (!rows.has(sid)) rows.set(sid, { name, days: new Map() });
    const day = new Date(l.startsAt).getDate();
    const state = l.attendance?.status ?? (l.status === 'scheduled' ? 'unmarked' : l.status);
    const bucket = rows.get(sid)!.days;
    bucket.set(day, [...(bucket.get(day) ?? []), state]);
  }
  const sorted = [...rows.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  const dayNumbers = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const totals = (days: Map<number, string[]>) => {
    let present = 0, missed = 0;
    for (const marks of days.values()) for (const m of marks) {
      if (m === 'present') present++;
      else if (m.startsWith('absent')) missed++;
    }
    return { present, missed };
  };

  return (
    <div className="bg-white rounded-2xl border border-[var(--bd)] overflow-hidden">
      <div className="px-5 py-3 border-b flex items-center justify-between gap-4 flex-wrap"
        style={{ borderColor: 'var(--bd)', background: 'var(--surf)' }}>
        <p className="font-bold text-sm" style={{ color: 'var(--txt)' }}>{monthLabel}</p>
        <div className="flex flex-wrap gap-3">
          {Object.entries(MONTH_CELL).map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--txt3)' }}>
              <span className="w-4 h-4 rounded flex items-center justify-center font-bold text-[10px]"
                style={{ background: v.bg, color: v.fg, border: '1px solid var(--bd2)' }}>{v.ch}</span>
              {v.label}
            </span>
          ))}
        </div>
      </div>

      {/* The grid scrolls inside its own box — a 31-column table must never
          make the whole page scroll sideways. */}
      <div className="overflow-x-auto">
        <table className="text-xs" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 text-left px-3 py-2 font-semibold whitespace-nowrap"
                style={{ background: 'white', color: 'var(--txt3)', borderBottom: '1px solid var(--bd)' }}>
                Student
              </th>
              {dayNumbers.map(d => (
                <th key={d} className="px-0 py-2 font-semibold text-center"
                  style={{ minWidth: 24, color: 'var(--txt4)', borderBottom: '1px solid var(--bd)' }}>{d}</th>
              ))}
              <th className="px-3 py-2 font-semibold text-right whitespace-nowrap"
                style={{ color: 'var(--txt3)', borderBottom: '1px solid var(--bd)' }}>Present / missed</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(([sid, row]) => {
              const t = totals(row.days);
              return (
                <tr key={sid}>
                  <td className="sticky left-0 z-10 px-3 py-1.5 whitespace-nowrap font-medium"
                    style={{ background: 'white', color: 'var(--txt)', borderBottom: '1px solid var(--bd)' }}>
                    {row.name}
                  </td>
                  {dayNumbers.map(d => {
                    const marks = row.days.get(d) ?? [];
                    return (
                      <td key={d} className="px-0 py-1.5 text-center" style={{ borderBottom: '1px solid var(--bd)' }}>
                        <span className="inline-flex gap-0.5 justify-center">
                          {marks.map((m, i) => {
                            const cell = MONTH_CELL[m] ?? MONTH_CELL.unmarked!;
                            return (
                              <span key={i} title={`${row.name} — ${d}: ${cell.label}`}
                                className="w-4 h-4 rounded flex items-center justify-center font-bold text-[10px]"
                                style={{ background: cell.bg, color: cell.fg }}>
                                {cell.ch}
                              </span>
                            );
                          })}
                        </span>
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums"
                    style={{ color: 'var(--txt3)', borderBottom: '1px solid var(--bd)' }}>
                    <span style={{ color: 'var(--sage-dk)' }}>{t.present}</span>
                    {' / '}
                    <span style={{ color: t.missed ? 'var(--coral)' : 'var(--txt4)' }}>{t.missed}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AttendancePage() {
  const [pending, setPending] = useState<Record<string, AttendanceStatus>>({});
  const [saving, setSaving] = useState<string | null>(null);
  // The already-marked lesson whose register the user is correcting, if any.
  // Marked rows are read-only until you click "Change" — a mis-tap here moves
  // money, so re-marking is deliberate rather than one stray click away.
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]!);
  const [search, setSearch] = useState('');
  // Day view marks today's register; month view is the read-only overview the
  // office asked for — one row per student, one column per day.
  const [view, setView] = useState<'day' | 'month'>('day');
  // Which present lesson's "paid at the lesson" method picker is open, plus a
  // local record of lessons paid this session (id → invoice number) and any
  // per-lesson error. The lesson feed doesn't carry payment state, so this only
  // reflects payments taken here — the office sees the invoice under Billing.
  const [payingId, setPayingId] = useState<string | null>(null);
  const [paid, setPaid] = useState<Record<string, string>>({});
  const [payErr, setPayErr] = useState<Record<string, string>>({});
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];
  const canTakePayment = CAN_TAKE_PAYMENT.includes(roleFromToken(tok()));

  async function takePayment(lessonId: string, method: 'cash' | 'card') {
    setSaving(lessonId);
    setPayErr(e => { const { [lessonId]: _drop, ...rest } = e; return rest; });
    try {
      const res = await apiFetch<{ invoiceNumber: string | null }>(`/lessons/${lessonId}/pay-at-lesson`, {
        method: 'POST', token: tok(), body: JSON.stringify({ method }),
      });
      setPaid(p => ({ ...p, [lessonId]: res.invoiceNumber ?? 'paid' }));
      setPayingId(null);
    } catch (e) {
      setPayErr(err => ({ ...err, [lessonId]: e instanceof Error ? e.message : 'Could not record payment' }));
    } finally { setSaving(null); }
  }

  const mon = new Date(date);
  mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  const weekStart = mon.toISOString().split('T')[0];

  // The calendar month containing `date`, as YYYY-MM-DD bounds.
  const monthStart = `${date.slice(0, 7)}-01`;
  const monthEndDate = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0);
  const monthEnd = `${date.slice(0, 7)}-${String(monthEndDate.getDate()).padStart(2, '0')}`;
  const daysInMonth = monthEndDate.getDate();

  // Only fetched when the month view is open — it's a wider query than the day
  // register needs, and most visits here never leave the day view.
  const { data: monthLessons = [], error: monthError, isLoading: monthLoading, mutate: reloadMonth } =
    useApi<Lesson[]>(view === 'month' ? `/lessons?from=${monthStart}&to=${monthEnd}` : null);

  // Cached read of the week's lessons; the day's scheduled lessons are derived.
  // load() refreshes after saving attendance.
  const { data: allLessons = [], mutate } = useApi<Lesson[]>(`/lessons?weekStart=${weekStart}`);
  const load = () => mutate();
  const lessons = allLessons.filter(l => l.startsAt.startsWith(date) && l.status === 'scheduled');

  // Seed the per-lesson "present" defaults when the set of lessons for the day
  // changes (date switch or new data) — keyed on the id signature so background
  // revalidations with the same lessons don't clobber in-progress selections.
  const lessonIdsKey = lessons.map(l => l.id).join(',');
  useEffect(() => {
    const defaults: Record<string, AttendanceStatus> = {};
    lessons.forEach(l => { if (!l.attendance) defaults[l.id] = 'present'; });
    setPending(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonIdsKey]);

  async function markOne(lessonId: string, status: AttendanceStatus) {
    setPending(p => ({ ...p, [lessonId]: status }));
    setSaving(lessonId);
    try {
      await apiFetch(`/lessons/${lessonId}/attendance`, {
        method: 'POST', token: tok(),
        body: JSON.stringify({ status }),
      });
      load();
      setCorrecting(null);
    } catch (e) { console.error(e); }
    finally { setSaving(null); }
  }

  async function confirmAll() {
    setSaving('all');
    // Lessons the user left on the default "present" (anything they changed to a
    // different status is marked individually, honouring their choice).
    const presentIds = lessons.filter(l => !l.attendance && (pending[l.id] ?? 'present') === 'present').map(l => l.id);
    const others = lessons.filter(l => !l.attendance && (pending[l.id] ?? 'present') !== 'present');
    try {
      if (presentIds.length > 0) {
        await apiFetch('/lessons/attendance/mark-present', {
          method: 'POST', token: tok(), body: JSON.stringify({ lessonIds: presentIds }),
        });
      }
      for (const lesson of others) {
        await apiFetch(`/lessons/${lesson.id}/attendance`, {
          method: 'POST', token: tok(), body: JSON.stringify({ status: pending[lesson.id] }),
        });
      }
    } catch (e) { console.error(e); }
    setSaving(null);
    load();
  }

  // Search by student or teacher name. On a busy day this page is a long list
  // of similar-looking rows and finding one pupil meant scrolling for them.
  const q = search.trim().toLowerCase();
  const matches = (l: Lesson) => !q || [
    l.student?.firstName, l.student?.lastName, l.teacher?.firstName, l.teacher?.lastName,
  ].filter(Boolean).join(' ').toLowerCase().includes(q);
  const unmarked = lessons.filter(l => !l.attendance).filter(matches);
  const marked = lessons.filter(l => l.attendance).filter(matches);

  return (
    <div>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Attendance
            <InfoTooltip text="Mark whether each student attended. This moves money: a lesson cancelled with 24 hours' notice or more costs the family nothing and the teacher isn't paid for it; cancelled with less notice, the family is charged and the teacher is paid. Try to mark the day before you leave." />
          </span>
        }
        subtitle="Quick-mark today's lessons"
      />

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex gap-1 p-1 rounded-xl border border-[var(--bd)]" style={{ background: 'var(--bg2)' }}>
          {([['day', 'Day'], ['month', 'Month']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setView(k)}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: view === k ? 'white' : 'transparent',
                color: view === k ? 'var(--txt)' : 'var(--txt4)',
                boxShadow: view === k ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-[var(--txt3)]" />
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border-[1.5px] border-[var(--bd2)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[var(--sage)] focus:shadow-[0_0_0_3px_var(--sage-lt)]" />
        </div>
        {view === 'day' && unmarked.length > 0 && (
          <button onClick={confirmAll} disabled={saving === 'all'}
            className="flex items-center gap-1.5 bg-[var(--sage)] text-white rounded-xl px-4 py-2 text-sm font-bold hover:bg-[var(--sage-dk)] disabled:opacity-50">
            <Check size={14} /> Confirm all as present ({unmarked.length})
          </button>
        )}
        {view === 'day' && unmarked.length > 0 && (
          <AutomatedHint by="attendanceAutocomplete" />
        )}
        <div className="relative flex-1 min-w-[12rem]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--txt4)' }}>
            <Search size={15} />
          </span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search student or teacher…"
            className="w-full pl-9 border-[1.5px] border-[var(--bd2)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[var(--sage)] focus:shadow-[0_0_0_3px_var(--sage-lt)]" />
        </div>
        <button onClick={() => { load(); if (view === 'month') reloadMonth(); }}
          className="flex items-center gap-1 text-sm border border-[var(--bd2)] rounded-xl px-3 py-2 hover:bg-[var(--surf)]">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {view === 'month' && <MonthGrid
        lessons={monthLessons.filter(matches)}
        daysInMonth={daysInMonth}
        monthLabel={new Date(`${monthStart}T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
        error={monthError}
        loading={monthLoading}
        onRetry={() => reloadMonth()}
      />}

      {view === 'day' && lessons.length === 0 && (
        <div className="bg-white rounded-2xl border border-[var(--bd)] px-6 py-12 text-center">
          <p className="text-[var(--txt3)]">No scheduled lessons for {date}.</p>
          <Link href="/app/calendar" className="text-sm text-[var(--sage)] hover:underline mt-2 block">View calendar →</Link>
        </div>
      )}

      {view === 'day' && unmarked.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--txt4)] mb-3 flex items-center gap-1.5">
            <AlertTriangle size={13} /> Needs marking ({unmarked.length})
          </p>
          <div className="space-y-2">
            {unmarked.map(l => {
              const isGroup = l.enrollment?.lessonType === 'group';
              const actions = isGroup ? GROUP_ACTIONS : PRIVATE_ACTIONS;
              const cur = pending[l.id] ?? 'present';
              return (
                <div key={l.id} className="bg-white rounded-2xl border border-[var(--bd)] p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <p className="font-semibold text-sm text-[var(--txt)]">
                        {fmtTime(l.startsAt)}
                        {' · '}
                        {l.student?.firstName} {l.student?.lastName}
                      </p>
                      <p className="text-xs text-[var(--txt3)] mt-0.5">
                        {l.duration} min · {l.teacher?.firstName} {l.teacher?.lastName}
                        {isGroup && <span className="ml-1.5 text-[var(--amber)] font-medium">· Group</span>}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {actions.map(a => (
                        <button key={a.status} onClick={() => markOne(l.id, a.status)} disabled={saving === l.id}
                          className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all disabled:opacity-50
                            ${cur === a.status ? `${a.bg} ${a.border} ${a.color}` : 'border-[var(--bd2)] text-[var(--txt3)] hover:border-[var(--bd)] hover:bg-[var(--surf)]'}`}>
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === 'day' && marked.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--txt4)] mb-3 flex items-center gap-1.5">
            <Check size={13} /> Marked ({marked.length})
          </p>
          <div className="space-y-1.5">
            {marked.map(l => {
              const isPresent = l.attendance?.status === 'present';
              const justPaid = paid[l.id];
              const showPay = canTakePayment && isPresent;
              const isGroup = l.enrollment?.lessonType === 'group';
              const actions = isGroup ? GROUP_ACTIONS : PRIVATE_ACTIONS;
              const isOpen = correcting === l.id;
              return (
                // Dimmed once marked, unless it's being corrected or still has a
                // payment to take (both are live actions worth full contrast).
                <div key={l.id} className={`bg-white rounded-xl border px-4 py-2.5 ${isOpen ? 'border-[var(--sage-md)]' : `border-[var(--bd)]${showPay ? '' : ' opacity-70'}`}`}>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-sm text-[var(--txt)]">
                      {fmtTime(l.startsAt)}
                      {' · '}
                      {l.student?.firstName} {l.student?.lastName}
                      {isGroup && <span className="ml-1.5 text-xs text-[var(--amber)] font-medium">· Group</span>}
                    </p>
                    <div className="flex items-center gap-2">
                      {/* Take cash/card handed over at the lesson. Records a paid
                          per-lesson invoice; the payment cancels the lesson's charge. */}
                      {showPay && (justPaid ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--sage-dk)' }}>
                          <Check size={13} /> Paid{justPaid !== 'paid' ? ` · ${justPaid}` : ''}
                        </span>
                      ) : payingId === l.id ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="text-xs text-[var(--txt3)] mr-1">Paid at lesson:</span>
                          <button onClick={() => takePayment(l.id, 'cash')} disabled={saving === l.id}
                            className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-[var(--bd2)] hover:bg-[var(--surf)] disabled:opacity-50">Cash</button>
                          <button onClick={() => takePayment(l.id, 'card')} disabled={saving === l.id}
                            className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-[var(--bd2)] hover:bg-[var(--surf)] disabled:opacity-50">Card</button>
                          <button onClick={() => setPayingId(null)} disabled={saving === l.id}
                            className="text-xs text-[var(--txt4)] hover:text-[var(--txt2)] px-1">Cancel</button>
                        </span>
                      ) : (
                        <button onClick={() => { setPayingId(l.id); setPayErr(e => { const { [l.id]: _d, ...r } = e; return r; }); }}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--txt3)] hover:text-[var(--sage-dk)] underline decoration-dotted underline-offset-2">
                          <PoundSterling size={12} /> Take payment
                        </button>
                      ))}
                      <Badge variant={l.attendance?.status ?? 'default'}>
                        {l.attendance?.status?.replace(/_/g, ' ')}
                      </Badge>
                      {/* Correct a mis-mark. The API reverses the previous status's
                          charge/credit and applies the new one, so the family's
                          balance ends up as if the correct mark had been made. */}
                      <button
                        onClick={() => setCorrecting(isOpen ? null : l.id)}
                        className="text-xs font-semibold text-[var(--txt3)] hover:text-[var(--sage-dk)] underline decoration-dotted underline-offset-2">
                        {isOpen ? 'Cancel' : 'Change'}
                      </button>
                    </div>
                  </div>
                  {payErr[l.id] && <p className="text-xs mt-1.5" style={{ color: 'var(--coral)' }}>{payErr[l.id]}</p>}
                  {isOpen && (
                    <div className="mt-3 pt-3 border-t border-[var(--bd)]">
                      <p className="text-xs text-[var(--txt3)] mb-2">
                        Correct the register — this reverses the previous charge or credit and applies the new one.
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {actions.map(a => {
                          const isCurrent = l.attendance?.status === a.status;
                          return (
                            <button key={a.status} onClick={() => markOne(l.id, a.status)}
                              disabled={saving === l.id || isCurrent}
                              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all disabled:opacity-50
                                ${isCurrent ? `${a.bg} ${a.border} ${a.color} cursor-default` : 'border-[var(--bd2)] text-[var(--txt3)] hover:border-[var(--bd)] hover:bg-[var(--surf)]'}`}>
                              {a.label}{isCurrent ? ' · current' : ''}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
