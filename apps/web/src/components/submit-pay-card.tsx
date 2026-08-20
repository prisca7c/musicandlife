'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Send, Check } from 'lucide-react';

// "Previous calendar month" — payroll runs are monthly in practice, and a
// teacher submitting mid-month almost always means "the month that just
// finished," not the partial one still in progress.
function previousMonthRange(): { start: string; end: string } {
  const now = new Date();
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const start = new Date(firstOfThisMonth); start.setMonth(start.getMonth() - 1);
  const end = new Date(firstOfThisMonth.getTime() - 86400000); // last day of previous month
  const toIso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: toIso(start), end: toIso(end) };
}

// Teachers can't create a payroll RUN with a made-up figure — this is purely
// "please review this real, already-computed period," identical in spirit to
// the existing expense/rate-change submit-for-approval pattern. Shared by
// /app/my-pay (the full form) and the dashboard (a compact quick-action) so
// both stay in sync with the same endpoint and copy.
export function SubmitPayCard({ compact = false }: { compact?: boolean }) {
  const defaults = previousMonthRange();
  const [periodStart, setPeriodStart] = useState(defaults.start);
  const [periodEnd, setPeriodEnd] = useState(defaults.end);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  async function submit() {
    setSaving(true); setError(''); setDone(false);
    try {
      await apiFetch('/staff/payroll/me', {
        method: 'POST', token: tok(), body: JSON.stringify({ periodStart, periodEnd }),
      });
      setDone(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not submit'); }
    finally { setSaving(false); }
  }

  return (
    <div className={`bg-white rounded-2xl border ${compact ? 'p-4' : 'p-5'}`} style={{ borderColor: 'var(--bd)' }}>
      <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--txt3)' }}>
        Submit pay for review
      </p>
      <p className="text-xs mb-3" style={{ color: 'var(--txt4)' }}>
        Tallies your lessons for this period at your rate and sends it to the office to check and approve — nothing is paid until they do.
      </p>
      {error && (
        <p className="text-xs mb-2 rounded-lg px-3 py-2" style={{ background: 'var(--coral-lt)', color: 'var(--coral)' }}>{error}</p>
      )}
      {done ? (
        <p className="text-sm flex items-center gap-2" style={{ color: 'var(--sage-dk)' }}>
          <Check size={16} /> Submitted — you&apos;ll see it here once it&apos;s approved.
        </p>
      ) : (
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label className="ui-label" htmlFor="pay-period-start">From</label>
            <input id="pay-period-start" type="date" value={periodStart}
              onChange={e => setPeriodStart(e.target.value)} className="ui-input" style={{ width: 150 }} />
          </div>
          <div>
            <label className="ui-label" htmlFor="pay-period-end">To</label>
            <input id="pay-period-end" type="date" value={periodEnd}
              onChange={e => setPeriodEnd(e.target.value)} className="ui-input" style={{ width: 150 }} />
          </div>
          <button onClick={submit} disabled={saving} className="ui-btn-primary text-sm flex items-center gap-1.5">
            <Send size={13} /> {saving ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      )}
    </div>
  );
}
