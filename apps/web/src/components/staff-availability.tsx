'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import { Modal } from '@/components/modal';
import { Plus, Trash2 } from 'lucide-react';

interface Window { id: string; weekday: string; startTime: string; endTime: string; }

const WEEKDAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];

export function StaffAvailability({ staffId }: { staffId: string }) {
  const [windows, setWindows] = useState<Window[]>([]);
  const [open, setOpen] = useState(false);
  const [weekday, setWeekday] = useState('monday');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  function load() {
    apiFetch<Window[]>(`/staff/${staffId}/availability`, { token: tok() })
      .then(setWindows).catch(() => {});
  }

  useEffect(() => { load(); }, [staffId]);

  async function add() {
    setSaving(true);
    try {
      await apiFetch(`/staff/${staffId}/availability`, {
        method: 'POST', token: tok(),
        body: JSON.stringify({ weekday, startTime, endTime }),
      });
      setOpen(false);
      load();
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  async function remove(windowId: string) {
    await apiFetch(`/staff/${staffId}/availability/${windowId}`, { method: 'DELETE', token: tok() });
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
        <button onClick={() => setOpen(true)}
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
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--txt3)' }}>Day</label>
            <select value={weekday} onChange={e => setWeekday(e.target.value)}
              className="w-full border border-[var(--bd2)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[var(--sage)] capitalize">
              {WEEKDAYS.map(d => <option key={d} value={d} className="capitalize">{d}</option>)}
            </select>
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
          <button onClick={add} disabled={saving}
            className="w-full bg-[var(--sage)] text-white font-bold text-sm py-2.5 rounded-xl hover:bg-[var(--sage-dk)] disabled:opacity-50">
            {saving ? 'Saving…' : 'Add window'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
