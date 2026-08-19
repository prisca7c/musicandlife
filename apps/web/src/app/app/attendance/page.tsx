'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { fmtTime, studioDayString } from '@/lib/datetime';
import { useRole } from '@/lib/use-role';
import { usePendingBadges } from '@/lib/use-pending-badges';
import { PageHeader } from '@/components/page-header';
import { InfoTooltip } from '@/components/info-tooltip';
import { Badge } from '@/components/badge';
import { AutomatedHint } from '@/components/automated-hint';
import { SectionTabs } from '@/components/section-tabs';
import { Check, X, AlertTriangle, Calendar, RefreshCw, Search, PoundSterling } from 'lucide-react';

// Roles allowed to take money at the front desk. Teachers mark attendance too,
// but they don't handle payments — so the "paid at the lesson" control is theirs
// to see, not press.
const CAN_TAKE_PAYMENT = ['admin'];

// Attendance and Requests no longer have their own sidebar entries — they
// live "under" Calendar, reached via this tab strip instead.
function sectionItems(badges: { unmarkedToday: number; pendingRequests: number }) {
  return [
    { label: 'Calendar', href: '/app/calendar' },
    { label: 'Attendance', href: '/app/attendance', badge: badges.unmarkedToday },
    { label: 'Requests', href: '/app/lesson-requests', badge: badges.pendingRequests },
  ];
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

export default function AttendancePage() {
  const badges = usePendingBadges();
  const [pending, setPending] = useState<Record<string, AttendanceStatus>>({});
  const [saving, setSaving] = useState<string | null>(null);
  // The already-marked lesson whose register the user is correcting, if any.
  // Marked rows are read-only until you click "Change" — a mis-tap here moves
  // money, so re-marking is deliberate rather than one stray click away.
  const [correcting, setCorrecting] = useState<string | null>(null);
  // Default to *today in the studio zone*, not new Date().toISOString() (UTC):
  // under BST (local = UTC+1) between 00:00 and 01:00 that rolls back to
  // yesterday, so the register would open on the wrong day's lessons.
  const [date, setDate] = useState(() => studioDayString(new Date()));
  const [search, setSearch] = useState('');
  // Which present lesson's "paid at the lesson" method picker is open, plus a
  // local record of lessons paid this session (id → invoice number) and any
  // per-lesson error. The lesson feed doesn't carry payment state, so this only
  // reflects payments taken here — the office sees the invoice under Billing.
  const [payingId, setPayingId] = useState<string | null>(null);
  const [paid, setPaid] = useState<Record<string, string>>({});
  const [payErr, setPayErr] = useState<Record<string, string>>({});
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];
  const canTakePayment = CAN_TAKE_PAYMENT.includes(useRole());

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

  // Monday of the selected week. Anchor `date` at local noon so getDay()/setDate
  // can't slip across a day boundary, then format as the STUDIO-zone day (as the
  // dashboard/calendar do) rather than .toISOString() (UTC), which under BST
  // rolled the week bound back to Sunday.
  const mon = new Date(`${date}T12:00:00`);
  mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  const weekStart = studioDayString(mon);

  // Cached read of the week's lessons; the day's markable lessons are derived.
  // load() refreshes after saving attendance.
  const { data: allLessons = [], mutate } = useApi<Lesson[]>(`/lessons?weekStart=${weekStart}`);
  const load = () => mutate();
  // Keep the day's still-scheduled lessons (to mark) *and* any already-marked
  // ones (to correct, or to take a payment against). Marking flips a lesson's
  // status off 'scheduled' (present → completed, absences → cancelled_*), so a
  // plain `status === 'scheduled'` filter dropped every marked lesson — which
  // silently starved the "Marked" section below of its correction and
  // take-payment controls. Include lessons that carry an attendance record too.
  const lessons = allLessons.filter(
    l => studioDayString(l.startsAt) === date && (l.status === 'scheduled' || !!l.attendance),
  );

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
      <SectionTabs items={sectionItems(badges)} />
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
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-[var(--txt3)]" />
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border-[1.5px] border-[var(--bd2)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[var(--sage)] focus:shadow-[0_0_0_3px_var(--sage-lt)]" />
        </div>
        {unmarked.length > 0 && (
          <button onClick={confirmAll} disabled={saving === 'all'}
            className="flex items-center gap-1.5 bg-[var(--sage)] text-white rounded-xl px-4 py-2 text-sm font-bold hover:bg-[var(--sage-dk)] disabled:opacity-50">
            <Check size={14} /> Confirm all as present ({unmarked.length})
          </button>
        )}
        {unmarked.length > 0 && (
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
        <button onClick={load}
          className="flex items-center gap-1 text-sm border border-[var(--bd2)] rounded-xl px-3 py-2 hover:bg-[var(--surf)]">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {lessons.length === 0 && (
        <div className="bg-white rounded-2xl border border-[var(--bd)] px-6 py-12 text-center">
          <p className="text-[var(--txt3)]">No scheduled lessons for {date}.</p>
          <Link href="/app/calendar" className="text-sm text-[var(--sage)] hover:underline mt-2 block">View calendar →</Link>
        </div>
      )}

      {unmarked.length > 0 && (
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

      {marked.length > 0 && (
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
