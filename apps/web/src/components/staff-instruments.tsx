'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { ALL_INSTRUMENTS } from '@music-life/types';
import { InstrumentIcon } from '@/components/instrument-icons';
import { Check } from 'lucide-react';

// Same instrument palette used on the calendar, so a teacher's instruments read
// consistently across the app.
const INSTR_HUE: Record<string, string> = {
  piano: '#3D7A55', violin: '#2B6CB0', guitar: '#B7791F', drums: '#C05621',
  cello: '#553C9A', viola: '#2C7A7B', 'bass guitar': '#276749', vocal: '#97266D',
  ukulele: '#D69E2E', 'susuki violin': '#2B6CB0', ensemble: '#718096',
};
function instrColor(name: string) { return INSTR_HUE[name] ?? '#4A5568'; }

/**
 * Visual editor for the instruments a teacher teaches. Toggle chips (icon +
 * name) that save immediately via PATCH /staff/:id. Admin/manager only.
 */
export function StaffInstruments({ staffId, instruments }: { staffId: string; instruments: string[] }) {
  const [selected, setSelected] = useState<string[]>(instruments);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [error, setError] = useState('');
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  async function toggle(name: string) {
    const next = selected.includes(name) ? selected.filter(i => i !== name) : [...selected, name];
    const prev = selected;
    setSelected(next); setError(''); setSaving(true); setSavedAt(false);
    try {
      await apiFetch(`/staff/${staffId}`, {
        method: 'PATCH', token: tok(), body: JSON.stringify({ instruments: next }),
      });
      setSavedAt(true);
      setTimeout(() => setSavedAt(false), 1500);
    } catch (e) {
      setSelected(prev); // roll back on failure
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally { setSaving(false); }
  }

  return (
    <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-sm uppercase tracking-wider" style={{ color: 'var(--txt3)' }}>Instruments taught</h2>
        <span className="text-[11px] font-semibold" style={{ color: savedAt ? 'var(--sage)' : 'var(--txt4)' }}>
          {saving ? 'Saving…' : savedAt ? 'Saved ✓' : `${selected.length} selected`}
        </span>
      </div>

      <p className="text-[11px] mb-3" style={{ color: 'var(--txt4)' }}>Tap an instrument to add or remove it from what this teacher teaches.</p>

      <div className="flex flex-wrap gap-2">
        {ALL_INSTRUMENTS.map(name => {
          const on = selected.includes(name);
          const c = instrColor(name);
          return (
            <button
              key={name}
              onClick={() => toggle(name)}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold capitalize border transition-all disabled:opacity-60"
              style={{
                borderColor: on ? c : 'var(--bd2)',
                background: on ? `${c}14` : '#fff',
                color: on ? c : 'var(--txt3)',
              }}
            >
              <span style={{ color: on ? c : 'var(--txt4)' }}><InstrumentIcon name={name} size={13} /></span>
              {name}
              {on && <Check size={12} />}
            </button>
          );
        })}
      </div>

      {error && <p className="text-xs mt-3" style={{ color: 'var(--coral)' }}>{error}</p>}
    </div>
  );
}
