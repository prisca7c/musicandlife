'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { Check, Pencil } from 'lucide-react';

/**
 * Editable payroll card for a staff member: hourly rate (what they're paid) and
 * the default lesson length used to prorate shorter/longer lessons. Saves via
 * PATCH /staff/:id. Read-only until "Edit" is pressed so a stray click can't
 * change someone's pay. Admin/manager only (the route already gates this).
 */
export function StaffPayrollEditor({
  staffId, payrollType, hourlyRate, defaultDuration,
}: {
  staffId: string; payrollType: string; hourlyRate: number | null; defaultDuration: number;
}) {
  const [editing, setEditing] = useState(false);
  const [rate, setRate] = useState(hourlyRate);          // pence, source of truth (null = paid outside payroll)
  const [duration, setDuration] = useState(defaultDuration);
  // Text mirror for the £ field so partial input (e.g. "28.") stays typable.
  const [rateText, setRateText] = useState(hourlyRate === null ? '' : (hourlyRate / 100).toFixed(2));
  const [noRate, setNoRate] = useState(hourlyRate === null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [error, setError] = useState('');
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  function cancel() {
    setRate(hourlyRate); setRateText(hourlyRate === null ? '' : (hourlyRate / 100).toFixed(2));
    setNoRate(hourlyRate === null);
    setDuration(defaultDuration); setError(''); setEditing(false);
  }

  async function save() {
    const pence = noRate ? null : Math.round(parseFloat(rateText) * 100);
    if (pence !== null && (!Number.isFinite(pence) || pence < 0)) { setError('Enter a valid rate.'); return; }
    if (!Number.isInteger(duration) || duration < 5 || duration > 240) { setError('Duration must be 5–240 minutes.'); return; }
    setSaving(true); setError('');
    try {
      await apiFetch(`/staff/${staffId}`, {
        method: 'PATCH', token: tok(),
        body: JSON.stringify({ hourlyRate: pence, defaultDuration: duration }),
      });
      setRate(pence); setRateText(pence === null ? '' : (pence / 100).toFixed(2));
      setSavedAt(true); setEditing(false);
      setTimeout(() => setSavedAt(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally { setSaving(false); }
  }

  const inputCls = 'w-24 border rounded-lg px-2.5 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-[var(--sage)]';

  return (
    <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-sm uppercase tracking-wider" style={{ color: 'var(--txt3)' }}>Payroll</h2>
        {editing ? (
          <span className="text-[11px] font-semibold" style={{ color: 'var(--txt4)' }}>{saving ? 'Saving…' : 'Editing'}</span>
        ) : (
          <button onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold hover:underline" style={{ color: 'var(--sage)' }}>
            {savedAt ? <>Saved <Check size={12} /></> : <><Pencil size={11} /> Edit</>}
          </button>
        )}
      </div>

      <dl className="space-y-3 text-sm">
        <div className="flex justify-between items-center gap-3">
          <dt style={{ color: 'var(--txt3)' }}>Type</dt>
          <dd className="font-medium capitalize">{payrollType}</dd>
        </div>
        <div className="flex justify-between items-center gap-3">
          <dt style={{ color: 'var(--txt3)' }}>Rate</dt>
          <dd className="font-medium">
            {editing ? (
              <span className="inline-flex flex-col items-end gap-1.5">
                <span className="inline-flex items-center gap-1">
                  £<input type="number" step="0.01" min="0" value={rateText} disabled={noRate}
                    onChange={e => setRateText(e.target.value)} className={inputCls} style={noRate ? { opacity: 0.5 } : undefined} /> /hr
                </span>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--txt3)' }}>
                  <input type="checkbox" checked={noRate} onChange={e => setNoRate(e.target.checked)}
                    className="accent-[var(--sage)]" />
                  Paid outside payroll (no rate)
                </label>
              </span>
            ) : rate === null ? <span style={{ color: 'var(--txt4)' }}>Paid outside payroll</span> : `${formatMoney(rate)}/hr`}
          </dd>
        </div>
        <div className="flex justify-between items-center gap-3">
          <dt style={{ color: 'var(--txt3)' }}>Default duration</dt>
          <dd className="font-medium">
            {editing ? (
              <span className="inline-flex items-center gap-1">
                <input type="number" step="5" min="5" max="240" value={duration}
                  onChange={e => setDuration(parseInt(e.target.value || '0', 10))} className={inputCls} /> min
              </span>
            ) : `${duration} min`}
          </dd>
        </div>
      </dl>

      {editing && (
        <div className="flex gap-2 mt-4">
          <button onClick={save} disabled={saving}
            className="bg-[var(--sage)] text-white rounded-lg px-3.5 py-1.5 text-xs font-semibold hover:bg-[var(--sage-dk)] disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={cancel} disabled={saving}
            className="rounded-lg px-3.5 py-1.5 text-xs font-semibold border hover:bg-gray-50">Cancel</button>
        </div>
      )}
      {error && <p className="text-xs mt-3" style={{ color: 'var(--coral)' }}>{error}</p>}

      <p className="text-[11px] mt-3" style={{ color: 'var(--txt4)' }}>
        The rate is what this teacher is paid per hour; the default duration is the lesson length their rate assumes — shorter or longer lessons are prorated against it.
      </p>
    </div>
  );
}
