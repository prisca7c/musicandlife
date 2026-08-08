'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { STUDIO_TZ } from '@/lib/datetime';
import { PageHeader } from '@/components/page-header';
import { InfoTooltip } from '@/components/info-tooltip';
import { Check, X, CalendarPlus, CalendarClock, Repeat } from 'lucide-react';

interface Option { rank: number; startsAt: string; ok: boolean; reason: string | null }
interface Req {
  id: string;
  status: string;
  isRecurring: boolean;
  createdAt: string;
  duration: number;
  notes: string | null;
  student: { firstName: string; lastName: string } | null;
  teacher: { firstName: string; lastName: string } | null;
  enrollment: { instrument: string; lessonType: string; groupName: string | null } | null;
  requestedByUser: { email: string } | null;
  options: Option[];
}

interface RescheduleReq {
  id: string;
  status: string;
  createdAt: string;
  reason: string | null;
  lesson: {
    startsAt: string;
    duration: number;
    student: { firstName: string; lastName: string } | null;
    teacher: { firstName: string; lastName: string } | null;
  } | null;
  requestedByUser: { email: string } | null;
  options: Option[];
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: STUDIO_TZ,
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

// Booking a new lesson and moving an existing one both end with front desk
// choosing one of a few offered times, so they live in one tab instead of two
// nav items that did the same job with different verbs (confirm vs approve/deny).
function RescheduleTab() {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  const { data: requests = [], isLoading: loading, error: loadError, mutate } = useApi<RescheduleReq[]>('/reschedule-requests?status=pending');
  const load = () => mutate();

  async function approve(id: string, chosenStartsAt: string) {
    setBusyId(id); setError('');
    try {
      await apiFetch(`/reschedule-requests/${id}/approve`, {
        method: 'POST', token: tok(), body: JSON.stringify({ chosenStartsAt }),
      });
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not approve'); }
    finally { setBusyId(null); }
  }

  async function deny(id: string) {
    setBusyId(id); setError('');
    try {
      await apiFetch(`/reschedule-requests/${id}/deny`, { method: 'POST', token: tok(), body: JSON.stringify({}) });
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not deny'); }
    finally { setBusyId(null); }
  }

  return (
    <div>
      {error && (
        <div className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}
      {loadError ? (
        <div className="rounded-2xl px-6 py-12 text-center" style={{ background: 'var(--card)', border: '1px solid var(--bd)' }}>
          <p className="text-sm mb-3" style={{ color: 'var(--coral)' }}>
            {loadError instanceof Error ? loadError.message : 'Could not load reschedule requests.'}
          </p>
          <button onClick={() => mutate()} className="ui-btn-ghost text-xs px-3 py-1.5">Try again</button>
        </div>
      ) : loading ? (
        <p className="text-sm" style={{ color: 'var(--txt3)' }}>Loading…</p>
      ) : requests.length === 0 ? (
        <div className="rounded-2xl px-6 py-12 text-center" style={{ background: 'var(--card)', border: '1px solid var(--bd)' }}>
          <CalendarClock size={28} style={{ color: 'var(--txt4)', margin: '0 auto 8px' }} />
          <p className="text-sm" style={{ color: 'var(--txt3)' }}>No pending reschedule requests.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((r) => (
            <div key={r.id} className="rounded-2xl p-5" style={{ background: 'var(--card)', border: '1px solid var(--bd)' }}>
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <p className="font-semibold" style={{ color: 'var(--txt)' }}>
                    {r.lesson?.student ? `${r.lesson.student.firstName} ${r.lesson.student.lastName}` : 'Student'}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--txt3)' }}>
                    {r.lesson?.teacher ? `with ${r.lesson.teacher.firstName} ${r.lesson.teacher.lastName} · ` : ''}
                    Currently: {r.lesson ? fmt(r.lesson.startsAt) : '—'} · {r.lesson?.duration ?? 30} min
                    {r.requestedByUser ? ` · requested by ${r.requestedByUser.email}` : ''}
                  </p>
                </div>
                <button
                  onClick={() => deny(r.id)}
                  disabled={busyId === r.id}
                  className="text-xs font-semibold rounded-lg px-3 py-1.5 disabled:opacity-50"
                  style={{ border: '1.5px solid var(--coral)', color: 'var(--coral)', background: '#fff' }}
                >
                  Deny
                </button>
              </div>

              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--txt3)' }}>Preferred times</p>
              <div className="space-y-2">
                {r.options.map((o) => (
                  <div key={o.rank} className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5"
                    style={{ background: o.ok ? 'var(--sage-lt)' : 'var(--surf)', border: `1px solid ${o.ok ? 'var(--sage-md)' : 'var(--bd)'}` }}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="inline-flex items-center justify-center rounded-full text-[11px] font-bold w-5 h-5 shrink-0"
                        style={{ background: 'var(--card)', color: 'var(--txt2)', border: '1px solid var(--bd2)' }}>
                        {o.rank}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--txt)' }}>{fmt(o.startsAt)}</p>
                        <p className="text-[11px] flex items-center gap-1" style={{ color: o.ok ? 'var(--sage-dk)' : 'var(--coral)' }}>
                          {o.ok ? <><Check size={12} /> Free &amp; within hours</> : <><X size={12} /> {o.reason}</>}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => approve(r.id, o.startsAt)}
                      disabled={!o.ok || busyId === r.id}
                      className="ui-btn-primary text-xs shrink-0 disabled:opacity-40"
                    >
                      {busyId === r.id ? '…' : 'Approve this time'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BookingTab() {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  // Cached read: revisiting renders instantly, then revalidates. mutate()
  // refreshes after a confirm/decline.
  const { data: requests = [], isLoading: loading, mutate } = useApi<Req[]>('/lesson-requests?status=pending');
  const load = () => mutate();

  async function confirm(id: string, chosenStartsAt: string) {
    setBusyId(id); setError('');
    try {
      await apiFetch(`/lesson-requests/${id}/confirm`, {
        method: 'POST', token: tok(), body: JSON.stringify({ chosenStartsAt }),
      });
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not confirm'); }
    finally { setBusyId(null); }
  }

  // The teacher's own suggested times, keyed by request id.
  const [suggesting, setSuggesting] = useState<string | null>(null);
  const [suggestTimes, setSuggestTimes] = useState<string[]>(['']);

  async function counterPropose(id: string) {
    const times = suggestTimes.filter(Boolean);
    if (!times.length) { setError('Pick at least one time'); return; }
    setBusyId(id); setError('');
    try {
      await apiFetch(`/lesson-requests/${id}/counter-propose`, {
        method: 'POST', token: tok(),
        // datetime-local gives a naive wall-clock string; send it as-is so the
        // API interprets it in the studio timezone like every other booking.
        body: JSON.stringify({ times }),
      });
      setSuggesting(null); setSuggestTimes(['']);
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not suggest those times'); }
    finally { setBusyId(null); }
  }

  // Moving a recurring series to a different weekly time (no family back-ups exist
  // for a series, so the teacher picks the new slot).
  const [movingSeries, setMovingSeries] = useState<string | null>(null);
  const [seriesTime, setSeriesTime] = useState('');

  async function moveSeries(id: string) {
    if (!seriesTime) { setError('Pick a new weekly time'); return; }
    setBusyId(id); setError('');
    try {
      // datetime-local is a naive wall-clock string; the API reads it in the studio tz.
      await apiFetch(`/lesson-requests/${id}/move-series`, {
        method: 'POST', token: tok(), body: JSON.stringify({ newStartsAt: seriesTime }),
      });
      setMovingSeries(null); setSeriesTime('');
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not move the series'); }
    finally { setBusyId(null); }
  }

  async function decline(id: string) {
    // Declining an auto-booked request cancels a lesson that's ALREADY on the
    // family's calendar, so guard against a mis-click. (Front-desk proposals
    // aren't booked yet, so a lighter prompt is enough.)
    const booked = requests.find(r => r.id === id)?.status === 'auto_confirmed';
    const msg = booked
      ? 'Decline this booking? The lesson will be removed from the family’s calendar and they’ll be asked to pick another time. There’s no charge and they keep any credit.'
      : 'Decline this booking request?';
    if (!window.confirm(msg)) return;
    setBusyId(id); setError('');
    try {
      await apiFetch(`/lesson-requests/${id}/decline`, { method: 'POST', token: tok(), body: JSON.stringify({}) });
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not decline'); }
    finally { setBusyId(null); }
  }

  return (
    <div>
      {error && (
        <div className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--txt3)' }}>Loading…</p>
      ) : requests.length === 0 ? (
        <div className="rounded-2xl px-6 py-12 text-center" style={{ background: 'var(--card)', border: '1px solid var(--bd)' }}>
          <CalendarPlus size={28} style={{ color: 'var(--txt4)', margin: '0 auto 8px' }} />
          <p className="text-sm" style={{ color: 'var(--txt3)' }}>No pending booking requests.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((r) => (
            <div key={r.id} className="rounded-2xl p-5" style={{ background: 'var(--card)', border: '1px solid var(--bd)' }}>
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <p className="font-semibold flex flex-wrap items-center gap-2" style={{ color: 'var(--txt)' }}>
                    {r.student ? `${r.student.firstName} ${r.student.lastName}` : 'Student'}
                    {r.status === 'auto_confirmed' && (
                      <span className="text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5"
                        style={{ background: 'var(--sage-lt)', color: 'var(--sage-dk)' }}>
                        Already booked
                      </span>
                    )}
                    {r.isRecurring && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5"
                        style={{ background: 'var(--surf)', color: 'var(--txt2)', border: '1px solid var(--bd2)' }}>
                        <Repeat size={10} /> Repeats weekly
                      </span>
                    )}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--txt3)' }}>
                    {r.enrollment?.instrument ? <span className="capitalize">{r.enrollment.instrument}</span> : 'Lesson'}
                    {r.enrollment?.lessonType === 'group' && r.enrollment?.groupName ? ` · ${r.enrollment.groupName}` : ''}
                    {` · ${r.duration} min`}
                    {r.requestedByUser ? ` · from ${r.requestedByUser.email}` : ''}
                  </p>
                  {r.notes && <p className="text-xs italic mt-1" style={{ color: 'var(--txt4)' }}>&ldquo;{r.notes}&rdquo;</p>}
                </div>
                <button
                  onClick={() => decline(r.id)}
                  disabled={busyId === r.id}
                  className="text-xs font-semibold rounded-lg px-3 py-1.5 disabled:opacity-50"
                  style={{ border: '1.5px solid var(--coral)', color: 'var(--coral)', background: '#fff' }}
                >
                  Decline
                </button>
              </div>

              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--txt3)' }}>
                {r.status === 'counter_proposed'
                  ? 'Times the teacher suggested — confirm one to book it'
                  : r.status === 'auto_confirmed'
                  ? (r.isRecurring
                      ? 'Booked weekly time — keep it, or decline to stop the series'
                      : 'Booked time & back-ups — keep it, or move to a back-up')
                  : 'Proposed times'}
              </p>
              <div className="space-y-2">
                {r.options.map((o) => (
                  <div key={o.rank} className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5"
                    style={{ background: o.ok ? 'var(--sage-lt)' : 'var(--surf)', border: `1px solid ${o.ok ? 'var(--sage-md)' : 'var(--bd)'}` }}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="inline-flex items-center justify-center rounded-full text-[11px] font-bold w-5 h-5 shrink-0"
                        style={{ background: 'var(--card)', color: 'var(--txt2)', border: '1px solid var(--bd2)' }}>
                        {o.rank}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--txt)' }}>{fmt(o.startsAt)}</p>
                        <p className="text-[11px] flex items-center gap-1" style={{ color: o.ok ? 'var(--sage-dk)' : 'var(--coral)' }}>
                          {o.ok
                            ? <><Check size={12} /> {r.status === 'auto_confirmed' && o.rank === 1 ? 'Booked now — on the family’s calendar' : 'Free & within your hours'}</>
                            : <><X size={12} /> {o.reason}</>}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => confirm(r.id, o.startsAt)}
                      disabled={!o.ok || busyId === r.id}
                      className="ui-btn-primary text-xs shrink-0 disabled:opacity-40"
                    >
                      {busyId === r.id
                        ? '…'
                        : r.status === 'auto_confirmed'
                        ? (o.rank === 1 ? 'Keep this time' : 'Move here')
                        : 'Confirm this time'}
                    </button>
                  </div>
                ))}
              </div>

              {/* A recurring series has no family back-ups to move to, so let the
                  teacher rehome the whole series to a weekly time that suits them
                  instead of declining and making the family start over. */}
              {r.status === 'auto_confirmed' && r.isRecurring && (
                movingSeries === r.id ? (
                  <div className="mt-3 rounded-xl p-3" style={{ background: 'var(--surf)', border: '1px solid var(--bd)' }}>
                    <p className="text-xs font-semibold mb-2" style={{ color: 'var(--txt3)' }}>
                      Move the weekly lesson to a new day &amp; time
                    </p>
                    <input type="datetime-local" value={seriesTime}
                      onChange={(e) => setSeriesTime(e.target.value)} className="ui-input mb-2 text-sm" />
                    <p className="text-[11px] mb-2" style={{ color: 'var(--txt4)' }}>
                      The whole series moves to this weekday &amp; time every week. The family is notified.
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => moveSeries(r.id)} disabled={busyId === r.id}
                        className="ui-btn-primary text-xs disabled:opacity-50">
                        {busyId === r.id ? 'Moving…' : 'Move the series'}
                      </button>
                      <button onClick={() => { setMovingSeries(null); setError(''); }}
                        className="text-xs font-semibold rounded-lg px-3 py-1.5"
                        style={{ border: '1px solid var(--bd)', color: 'var(--txt3)' }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { setMovingSeries(r.id); setSeriesTime(''); setError(''); }}
                    className="mt-3 text-xs font-semibold rounded-lg px-3 py-1.5"
                    style={{ border: '1.5px solid var(--sage)', color: 'var(--sage-dk)', background: '#fff' }}
                  >
                    Move to a different weekly time
                  </button>
                )
              )}

              {/* Every proposed slot clashing is normal — the front desk is
                  guessing at the teacher's diary. Without this the only enabled
                  button was Decline, which sent the family back to square one. */}
              {r.options.every((o) => !o.ok) && suggesting !== r.id && (
                <button
                  onClick={() => { setSuggesting(r.id); setSuggestTimes(['']); setError(''); }}
                  className="mt-3 text-xs font-semibold rounded-lg px-3 py-1.5"
                  style={{ border: '1.5px solid var(--sage)', color: 'var(--sage-dk)', background: '#fff' }}
                >
                  None of these work — suggest a time
                </button>
              )}

              {suggesting === r.id && (
                <div className="mt-3 rounded-xl p-3" style={{ background: 'var(--surf)', border: '1px solid var(--bd)' }}>
                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--txt3)' }}>
                    Suggest up to 3 times that suit you
                  </p>
                  {suggestTimes.map((t, i) => (
                    <input
                      key={i}
                      type="datetime-local"
                      value={t}
                      onChange={(e) => {
                        const next = [...suggestTimes];
                        next[i] = e.target.value;
                        setSuggestTimes(next);
                      }}
                      className="ui-input mb-2 text-sm"
                    />
                  ))}
                  {suggestTimes.length < 3 && (
                    <button
                      onClick={() => setSuggestTimes([...suggestTimes, ''])}
                      className="text-xs font-semibold mb-2"
                      style={{ color: 'var(--sage-dk)' }}
                    >
                      + Add another time
                    </button>
                  )}
                  <div className="flex gap-2 mt-1">
                    <button
                      onClick={() => counterPropose(r.id)}
                      disabled={busyId === r.id}
                      className="ui-btn-primary text-xs disabled:opacity-50"
                    >
                      {busyId === r.id ? 'Sending…' : 'Send these to the front desk'}
                    </button>
                    <button
                      onClick={() => { setSuggesting(null); setError(''); }}
                      className="text-xs font-semibold rounded-lg px-3 py-1.5"
                      style={{ border: '1px solid var(--bd)', color: 'var(--txt3)' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
      style={active
        ? { background: 'var(--sage)', color: '#fff' }
        : { background: 'var(--card)', color: 'var(--txt3)', border: '1px solid var(--bd)' }}
    >
      {children}
    </button>
  );
}

function RequestsPageInner() {
  const params = useSearchParams();
  const [tab, setTab] = useState<'booking' | 'reschedule'>(params.get('tab') === 'reschedule' ? 'reschedule' : 'booking');
  // Pending counts for the tab labels, fetched independent of which tab is
  // active so switching tabs never shows a stale "0".
  const { data: bookingReqs = [] } = useApi<Req[]>('/lesson-requests?status=pending');
  const { data: rescheduleReqs = [] } = useApi<RescheduleReq[]>('/reschedule-requests?status=pending');

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Requests
            <InfoTooltip text="New bookings and reschedules both end the same way — front desk picks one of a few offered times. Booking requests may already be on the calendar (a family self-booked); reschedules move an existing lesson." />
          </span>
        }
        subtitle="Booking and reschedule requests — keep, move, confirm, or decline"
      />

      <div className="flex gap-2 mb-5">
        <TabButton active={tab === 'booking'} onClick={() => setTab('booking')}>
          New bookings{bookingReqs.length > 0 ? ` (${bookingReqs.length})` : ''}
        </TabButton>
        <TabButton active={tab === 'reschedule'} onClick={() => setTab('reschedule')}>
          Reschedules{rescheduleReqs.length > 0 ? ` (${rescheduleReqs.length})` : ''}
        </TabButton>
      </div>

      {tab === 'booking' ? <BookingTab /> : <RescheduleTab />}
    </div>
  );
}

export default function RequestsPage() {
  return (
    <Suspense fallback={<p className="text-sm" style={{ color: 'var(--txt3)' }}>Loading…</p>}>
      <RequestsPageInner />
    </Suspense>
  );
}
