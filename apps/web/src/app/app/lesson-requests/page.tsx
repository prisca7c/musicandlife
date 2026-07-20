'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { STUDIO_TZ } from '@/lib/datetime';
import { PageHeader } from '@/components/page-header';
import { InfoTooltip } from '@/components/info-tooltip';
import { Check, X, CalendarPlus } from 'lucide-react';

interface Option { rank: number; startsAt: string; ok: boolean; reason: string | null }
interface Req {
  id: string;
  status: string;
  createdAt: string;
  duration: number;
  notes: string | null;
  student: { firstName: string; lastName: string } | null;
  teacher: { firstName: string; lastName: string } | null;
  enrollment: { instrument: string; lessonType: string; groupName: string | null } | null;
  requestedByUser: { email: string } | null;
  options: Option[];
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: STUDIO_TZ,
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export default function LessonRequestsPage() {
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

  async function decline(id: string) {
    setBusyId(id); setError('');
    try {
      await apiFetch(`/lesson-requests/${id}/decline`, { method: 'POST', token: tok(), body: JSON.stringify({}) });
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not decline'); }
    finally { setBusyId(null); }
  }

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Booking requests
            <InfoTooltip text="When the front desk books a lesson for you, they propose up to three times inside your working hours. Pick the one that suits — we create the lesson the moment you confirm. Nothing is added to your calendar until you do." />
          </span>
        }
        subtitle="Lessons the front desk has proposed for you — pick a time to confirm"
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
          <CalendarPlus size={28} style={{ color: 'var(--txt4)', margin: '0 auto 8px' }} />
          <p className="text-sm" style={{ color: 'var(--txt3)' }}>No pending booking requests.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((r) => (
            <div key={r.id} className="rounded-2xl p-5" style={{ background: 'var(--card)', border: '1px solid var(--bd)' }}>
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <p className="font-semibold" style={{ color: 'var(--txt)' }}>
                    {r.student ? `${r.student.firstName} ${r.student.lastName}` : 'Student'}
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

              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--txt3)' }}>Proposed times</p>
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
                          {o.ok ? <><Check size={12} /> Free &amp; within your hours</> : <><X size={12} /> {o.reason}</>}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => confirm(r.id, o.startsAt)}
                      disabled={!o.ok || busyId === r.id}
                      className="ui-btn-primary text-xs shrink-0 disabled:opacity-40"
                    >
                      {busyId === r.id ? '…' : 'Confirm this time'}
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
