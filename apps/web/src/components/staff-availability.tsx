'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import { Modal } from '@/components/modal';
import { Plus, Trash2, CalendarOff } from 'lucide-react';

interface Window { id: string; weekday: string; startTime: string; endTime: string; }
interface TimeOff { id: string; startsAt: string; endsAt: string; reason: string | null; }

const WEEKDAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const SHORT: Record<string, string> = {
  monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu',
  friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
};
const PRESETS: { label: string; days: string[] }[] = [
  { label: 'Weekdays', days: ['monday','tuesday','wednesday','thursday','friday'] },
  { label: 'Weekend', days: ['saturday','sunday'] },
  { label: 'Every day', days: WEEKDAYS },
];

const fmtRange = (from: string, to: string) => {
  const a = new Date(from), b = new Date(to);
  const d = (x: Date) => x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return d(a) === d(b) ? d(a) : `${d(a)} – ${d(b)}`;
};

/**
 * Availability editor. Managers pass a `staffId` to edit any teacher's windows;
 * teachers pass `self` to edit their own via the self-scoped `/staff/me` routes.
 */
export function StaffAvailability({ staffId, self = false }: { staffId?: string; self?: boolean }) {
  const base = self ? '/staff/me/availability' : `/staff/${staffId}/availability`;
  const offBase = self ? '/staff/me/time-off' : `/staff/${staffId}/time-off`;
  const [windows, setWindows] = useState<Window[]>([]);
  const [timeOff, setTimeOff] = useState<TimeOff[]>([]);
  const [open, setOpen] = useState(false);
  // Multiple days per submit: a teacher who works 4–8pm Mon–Fri had to open
  // this dialog and re-enter the same two times five separate times.
  const [days, setDays] = useState<string[]>(['monday']);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [offOpen, setOffOpen] = useState(false);
  const [offFrom, setOffFrom] = useState('');
  const [offTo, setOffTo] = useState('');
  const [offReason, setOffReason] = useState('');
  const [offSaving, setOffSaving] = useState(false);
  const [offError, setOffError] = useState('');
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  function load() {
    apiFetch<Window[]>(base, { token: tok() })
      .then(setWindows).catch(() => {});
    apiFetch<TimeOff[]>(offBase, { token: tok() })
      .then(setTimeOff).catch(() => {});
  }

  useEffect(() => { load(); }, [base]);

  function toggleDay(d: string) {
    setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  }

  async function add() {
    setError('');
    if (days.length === 0) { setError('Choose at least one day.'); return; }
    if (endTime <= startTime) { setError('End time must be after start time.'); return; }
    setSaving(true);
    try {
      await apiFetch(base, {
        method: 'POST', token: tok(),
        body: JSON.stringify({ weekdays: days, startTime, endTime }),
      });
      setOpen(false);
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add window'); }
    finally { setSaving(false); }
  }

  async function remove(windowId: string) {
    await apiFetch(`${base}/${windowId}`, { method: 'DELETE', token: tok() });
    load();
  }

  async function addTimeOff() {
    setOffError('');
    if (!offFrom || !offTo) { setOffError('Choose a first and last day.'); return; }
    if (offTo < offFrom) { setOffError('The last day must not be before the first.'); return; }
    setOffSaving(true);
    try {
      // Whole days: from 00:00 on the first day to 23:59:59 on the last, so a
      // single-day absence blocks that entire day rather than a zero-length span.
      await apiFetch(offBase, {
        method: 'POST', token: tok(),
        body: JSON.stringify({
          startsAt: new Date(`${offFrom}T00:00:00`).toISOString(),
          endsAt: new Date(`${offTo}T23:59:59`).toISOString(),
          reason: offReason.trim() || undefined,
        }),
      });
      setOffOpen(false); setOffFrom(''); setOffTo(''); setOffReason('');
      load();
    } catch (e) { setOffError(e instanceof Error ? e.message : 'Could not save time off'); }
    finally { setOffSaving(false); }
  }

  async function removeTimeOff(id: string) {
    await apiFetch(`${offBase}/${id}`, { method: 'DELETE', token: tok() });
    load();
  }

  const byDay = WEEKDAYS.reduce<Record<string, Window[]>>((acc, d) => {
    acc[d] = windows.filter(w => w.weekday === d);
    return acc;
  }, {});

  return (
    <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--bd)' }}>
      <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--bd)', background: 'var(--surf)' }}>
        <h2 className="font-bold text-sm" style={{ color: 'var(--txt)' }}>Availability windows</h2>
        <button onClick={() => { setError(''); setOpen(true); }}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[var(--sage)] text-white hover:bg-[var(--sage-dk)]">
          <Plus size={13} /> Add window
        </button>
      </div>

      <div className="p-5">
        {windows.length === 0 ? (
          <p className="text-sm text-center py-6" style={{ color: 'var(--txt4)' }}>
            No availability set. Add windows so students can book lessons.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {WEEKDAYS.filter(d => byDay[d]!.length > 0).map(d => (
              <div key={d} className="rounded-xl border p-3" style={{ borderColor: 'var(--bd)', background: 'var(--surf)' }}>
                <p className="text-xs font-bold uppercase tracking-widest mb-2 capitalize" style={{ color: 'var(--txt3)' }}>{d}</p>
                <div className="space-y-1.5">
                  {byDay[d]!.map(w => (
                    <div key={w.id} className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium" style={{ color: 'var(--txt)' }}>
                        {w.startTime} – {w.endTime}
                      </span>
                      <button onClick={() => remove(w.id)}
                        className="text-[var(--txt4)] hover:text-[var(--coral)] transition-colors p-0.5">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Add availability window">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--txt3)' }}>
              Days <span className="font-normal" style={{ color: 'var(--txt4)' }}>— pick as many as you like</span>
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {WEEKDAYS.map(d => {
                const on = days.includes(d);
                return (
                  <button key={d} type="button" onClick={() => toggleDay(d)}
                    aria-pressed={on}
                    className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition"
                    style={on
                      ? { borderColor: 'var(--sage)', background: 'var(--sage-lt)', color: 'var(--sage-dk)' }
                      : { borderColor: 'var(--bd2)', color: 'var(--txt3)' }}>
                    {SHORT[d]}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map(p => (
                <button key={p.label} type="button" onClick={() => setDays(p.days)}
                  className="text-[11px] font-semibold underline decoration-dotted" style={{ color: 'var(--txt3)' }}>
                  {p.label}
                </button>
              ))}
              <button type="button" onClick={() => setDays([])}
                className="text-[11px] font-semibold underline decoration-dotted" style={{ color: 'var(--txt4)' }}>
                Clear
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--txt3)' }}>Start time</label>
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                className="w-full border border-[var(--bd2)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[var(--sage)]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--txt3)' }}>End time</label>
              <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                className="w-full border border-[var(--bd2)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[var(--sage)]" />
            </div>
          </div>
          {error && <p className="text-xs" style={{ color: 'var(--coral)' }}>{error}</p>}
          <button onClick={add} disabled={saving}
            className="w-full bg-[var(--sage)] text-white font-bold text-sm py-2.5 rounded-xl hover:bg-[var(--sage-dk)] disabled:opacity-50">
            {saving ? 'Saving…' : days.length > 1 ? `Add to ${days.length} days` : 'Add window'}
          </button>
        </div>
      </Modal>

      {/* ── Time off ──────────────────────────────────────────────────────────
          A dated exception on top of the weekly pattern. Before this, going on
          holiday meant deleting your weekly windows and remembering to put them
          back afterwards. */}
      <div className="border-t" style={{ borderColor: 'var(--bd)' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ background: 'var(--surf)' }}>
          <div>
            <h2 className="font-bold text-sm" style={{ color: 'var(--txt)' }}>Time off</h2>
            <p className="text-xs" style={{ color: 'var(--txt4)' }}>
              Holidays and one-off absences. Nobody can book you on these dates, and your weekly hours stay as they are.
            </p>
          </div>
          <button onClick={() => { setOffError(''); setOffOpen(true); }}
            className="shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border hover:bg-white"
            style={{ borderColor: 'var(--bd2)', color: 'var(--txt)' }}>
            <CalendarOff size={13} /> Add time off
          </button>
        </div>
        <div className="p-5">
          {timeOff.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: 'var(--txt4)' }}>No time off booked.</p>
          ) : (
            <div className="space-y-1.5">
              {timeOff.map(t => {
                const past = new Date(t.endsAt) < new Date();
                return (
                  <div key={t.id} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2"
                    style={{ borderColor: 'var(--bd)', opacity: past ? 0.55 : 1 }}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--txt)' }}>
                        {fmtRange(t.startsAt, t.endsAt)}
                        {past && <span className="ml-2 text-[11px] font-normal" style={{ color: 'var(--txt4)' }}>past</span>}
                      </p>
                      {t.reason && <p className="text-xs truncate" style={{ color: 'var(--txt3)' }}>{t.reason}</p>}
                    </div>
                    <button onClick={() => removeTimeOff(t.id)}
                      className="text-[var(--txt4)] hover:text-[var(--coral)] transition-colors p-0.5 shrink-0"
                      aria-label="Remove time off">
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Modal open={offOpen} onClose={() => setOffOpen(false)} title="Add time off">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--txt3)' }}>First day</label>
              <input type="date" value={offFrom} onChange={e => { setOffFrom(e.target.value); if (!offTo) setOffTo(e.target.value); }}
                className="w-full border border-[var(--bd2)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[var(--sage)]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--txt3)' }}>Last day</label>
              <input type="date" value={offTo} min={offFrom || undefined} onChange={e => setOffTo(e.target.value)}
                className="w-full border border-[var(--bd2)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[var(--sage)]" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--txt3)' }}>
              Reason <span className="font-normal" style={{ color: 'var(--txt4)' }}>(optional)</span>
            </label>
            <input value={offReason} onChange={e => setOffReason(e.target.value)} maxLength={200}
              placeholder="Holiday"
              className="w-full border border-[var(--bd2)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[var(--sage)]" />
          </div>
          <p className="text-xs" style={{ color: 'var(--txt4)' }}>
            This blocks whole days. Lessons already booked in this period aren&apos;t cancelled automatically —
            check your calendar and reschedule them.
          </p>
          {offError && <p className="text-xs" style={{ color: 'var(--coral)' }}>{offError}</p>}
          <button onClick={addTimeOff} disabled={offSaving}
            className="w-full bg-[var(--sage)] text-white font-bold text-sm py-2.5 rounded-xl hover:bg-[var(--sage-dk)] disabled:opacity-50">
            {offSaving ? 'Saving…' : 'Add time off'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
