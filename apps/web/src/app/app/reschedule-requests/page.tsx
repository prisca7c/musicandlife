'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { InfoTooltip } from '@/components/info-tooltip';
import { Check, X, CalendarClock } from 'lucide-react';

interface Option { rank: number; startsAt: string; ok: boolean; reason: string | null }
interface Req {
  id: string;
  status: string;
  createdAt: string;
  reason: string | null;
  lesson: {
    startsAt: string;
    duration: number;
    student: { firstName: string; lastName: string } | null;
  } | null;
  requestedByUser: { email: string } | null;
  options: Option[];
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export default function RescheduleRequestsPage() {
  const [requests, setRequests] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<Req[]>('/reschedule-requests?status=pending', { token: tok() })
      .then((r) => setRequests(r))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load requests'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

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
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Reschedule requests
            <InfoTooltip text="Families can propose up to three preferred times. We check each one against the teacher's schedule and working hours, then show you which are free (green) or clash (red) — so you can slot students back-to-back and approve the best fit in one click." />
          </span>
        }
        subtitle="Pending requests from families — pick the time that works best"
      />

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
