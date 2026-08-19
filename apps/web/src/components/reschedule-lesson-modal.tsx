'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import { studioDayString } from '@/lib/datetime';
import { Modal } from '@/components/modal';
import { InfoTooltip } from '@/components/info-tooltip';
import { Check } from 'lucide-react';

// 15-minute time slots (08:00–21:00) so parents pick a tidy time, never "3:27pm".
const RESCHED_TIME_OPTIONS = (() => {
  const out: { value: string; label: string }[] = [];
  for (let m = 8 * 60; m <= 21 * 60; m += 15) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    const value = `${hh}:${mm}`;
    const h12 = ((Math.floor(m / 60) + 11) % 12) + 1;
    const ampm = m < 12 * 60 ? 'am' : 'pm';
    out.push({ value, label: `${h12}:${mm} ${ampm}` });
  }
  return out;
})();

// Shared by the family dashboard's "next lesson" card and the family
// calendar's click-through lesson detail — up to three ranked preferred
// slots, sent to the studio to match against the teacher's actual schedule.
export function RescheduleLessonModal({ open, onClose, lessonId, onSent }: {
  open: boolean; onClose: () => void; lessonId: string | null; onSent: () => void;
}) {
  const [dates, setDates] = useState<[string, string, string]>(['', '', '']);
  const [times, setTimes] = useState<[string, string, string]>(['', '', '']);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  useEffect(() => {
    if (!open) return;
    setDates(['', '', '']); setTimes(['', '', '']); setErr(''); setDone(false);
  }, [open]);

  async function submit() {
    if (!lessonId) return;
    if (!dates[0] || !times[0]) { setErr('Please choose a date and time for your first preferred slot.'); return; }
    setSaving(true); setErr('');
    try {
      // Compose the naive wall-clock exactly as picked (e.g. "2026-07-13T16:00:00");
      // the backend interprets it in the studio timezone. Converting via
      // new Date().toISOString() here would wrongly bake in the parent's *browser*
      // timezone. A choice only counts when both its date and time are set.
      const toIso = (i: number) => dates[i] && times[i] ? `${dates[i]}T${times[i]}:00` : undefined;
      await apiFetch('/reschedule-requests', {
        method: 'POST', token: tok(),
        body: JSON.stringify({
          lessonId, proposedStartsAt: toIso(0), proposedStartsAt2: toIso(1), proposedStartsAt3: toIso(2),
        }),
      });
      setDone(true);
      onSent();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not send request'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Request a reschedule">
      {done ? (
        <div className="text-center py-4">
          <div className="inline-flex items-center justify-center w-11 h-11 rounded-full mb-3"
            style={{ background: 'var(--sage-lt)', color: 'var(--sage-dk)' }}>
            <Check size={22} />
          </div>
          <p className="font-semibold" style={{ color: 'var(--txt)' }}>Request sent</p>
          <p className="text-sm mt-1" style={{ color: 'var(--txt3)' }}>
            The studio will pick whichever of your preferred times works best for the teacher and let you know.
          </p>
          <button onClick={onClose} className="ui-btn-primary mt-4">Done</button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm flex items-start gap-1.5" style={{ color: 'var(--txt3)' }}>
            <span>Give up to three preferred slots, in order of preference. The studio picks whichever works best for the teacher.</span>
            <InfoTooltip text="You don't have to match the teacher's schedule yourself. Offering a few options lets the studio slot you into a time the teacher is actually free, often back-to-back with other lessons. Only your 1st choice is required." />
          </p>
          {err && (
            <div className="text-sm rounded-xl px-4 py-3"
              style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
              {err}
            </div>
          )}
          {([0, 1, 2] as const).map((i) => {
            const ordinal = i === 0 ? '1st choice' : i === 1 ? '2nd choice' : '3rd choice';
            return (
              <div key={i}>
                <label htmlFor={`resched-date-${i}`} className="ui-label">
                  {ordinal}
                  {i === 0 ? <span style={{ color: 'var(--coral)' }}> *</span> : <span className="font-normal text-[11px]" style={{ color: 'var(--txt4)' }}> (optional)</span>}
                </label>
                <div className="flex gap-2">
                  <input
                    id={`resched-date-${i}`}
                    type="date"
                    value={dates[i]}
                    min={studioDayString(new Date())}
                    onChange={(e) => setDates((t) => { const n = [...t] as [string, string, string]; n[i] = e.target.value; return n; })}
                    className="ui-input flex-1"
                  />
                  <select
                    aria-label={`${ordinal} time`}
                    value={times[i]}
                    onChange={(e) => setTimes((t) => { const n = [...t] as [string, string, string]; n[i] = e.target.value; return n; })}
                    className="ui-input shrink-0" style={{ width: 128 }}
                  >
                    <option value="">Time…</option>
                    {RESCHED_TIME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
            );
          })}
          <div className="flex gap-3 pt-1">
            <button onClick={submit} disabled={saving} className="ui-btn-primary">
              {saving ? 'Sending…' : 'Send request'}
            </button>
            <button onClick={onClose} className="ui-btn-ghost">Cancel</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
