'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { InstrumentIcon } from '@/components/instrument-icons';
import { Plus, Trash2, Check, X } from 'lucide-react';

interface Instrument {
  id: string;
  name: string;
  availablePrivate: boolean;
  availableGroup: boolean;
  active: boolean;
  sortOrder: number;
  note: string | null;
}

/**
 * Free-text note shown to families under the chips when they pick this
 * instrument. Saves on blur so there is nothing extra to click; the local draft
 * means typing isn't fighting a re-render on every keystroke.
 *
 * Declared at module scope on purpose: nested inside the editor it would be a
 * fresh component type on every parent render, so React would remount it and
 * the caret would jump out of the field mid-sentence.
 */
function NoteCell({
  inst,
  disabled,
  onSave,
}: {
  inst: Instrument;
  disabled: boolean;
  onSave: (note: string) => void;
}) {
  const [draft, setDraft] = useState(inst.note ?? '');
  const saved = (inst.note ?? '').trim();
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft.trim() !== saved) onSave(draft.trim()); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      disabled={disabled}
      maxLength={400}
      placeholder="Add a note…"
      aria-label={`Registration note for ${inst.name}`}
      className="w-full px-2 py-1 rounded-lg border text-[12px] outline-none focus:border-[var(--sage-md)] disabled:opacity-50"
      style={{ borderColor: draft ? 'var(--bd2)' : 'transparent', background: draft ? '#fff' : 'transparent' }}
    />
  );
}

/**
 * Edits what the public registration form offers. An instrument can be private,
 * group, or both. Retiring one (the Offered toggle) hides it from new
 * registrations; deleting removes it outright. Neither touches existing
 * enrollments, which store the instrument as plain text.
 */
export function InstrumentsEditor() {
  const { data: list, mutate } = useApi<Instrument[]>('/instruments');
  const [name, setName] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [isGroup, setIsGroup] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Confirming inline rather than through window.confirm — same as the payroll
  // editor, which reads better than a browser dialog interrupting the page.
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  async function add() {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) return;
    if (!isPrivate && !isGroup) {
      setError('Pick at least one lesson type.');
      return;
    }
    setBusy('add');
    setError('');
    try {
      await apiFetch('/instruments', {
        method: 'POST',
        body: JSON.stringify({ name: trimmed, availablePrivate: isPrivate, availableGroup: isGroup }),
      });
      setName('');
      setIsPrivate(true);
      setIsGroup(false);
      mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that instrument.');
    } finally {
      setBusy(null);
    }
  }

  async function patch(id: string, body: Partial<Instrument>) {
    setBusy(id);
    setError('');
    try {
      await apiFetch(`/instruments/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that change.');
    } finally {
      setBusy(null);
    }
  }

  async function remove(inst: Instrument) {
    setConfirmingDelete(null);
    setBusy(inst.id);
    setError('');
    try {
      await apiFetch(`/instruments/${inst.id}`, { method: 'DELETE' });
      mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that instrument.');
    } finally {
      setBusy(null);
    }
  }

  const Toggle = ({ on, onClick, disabled, label }: { on: boolean; onClick: () => void; disabled?: boolean; label: string }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors disabled:opacity-50
        ${on ? 'bg-[var(--sage-lt)] border-[var(--sage-md)] text-[var(--sage)]' : 'bg-white border-[var(--bd2)] text-[var(--txt4)]'}`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <p className="text-[13px] text-[var(--txt3)] mb-4">
        What families can choose on the registration form. Changes appear on the form straight away.
        A note is shown to the family when they pick that instrument — useful where the name alone
        doesn&apos;t say enough, like a package that includes both a group class and a 1-on-1.
      </p>

      {error && (
        <div className="mb-3 text-[12px] font-semibold text-[var(--coral)]">{error}</div>
      )}

      <div className="rounded-xl border overflow-hidden mb-4" style={{ borderColor: 'var(--bd)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider" style={{ background: 'var(--surf)', color: 'var(--txt3)' }}>
              <th className="px-4 py-2.5 font-bold">Instrument</th>
              <th className="px-4 py-2.5 font-bold">Lesson types</th>
              <th className="px-4 py-2.5 font-bold w-[34%]">Note shown at registration</th>
              <th className="px-4 py-2.5 font-bold">Offered</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {!list && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[13px]" style={{ color: 'var(--txt4)' }}>Loading…</td></tr>
            )}
            {list?.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[13px]" style={{ color: 'var(--txt4)' }}>No instruments yet.</td></tr>
            )}
            {list?.map((inst) => (
              <tr key={inst.id} className="border-t" style={{ borderColor: 'var(--bd)' }}>
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2 font-semibold capitalize">
                    <InstrumentIcon name={inst.name} size={18} />
                    {inst.name}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <span className="flex gap-1.5">
                    <Toggle
                      label="Private"
                      on={inst.availablePrivate}
                      disabled={busy === inst.id}
                      onClick={() => patch(inst.id, { availablePrivate: !inst.availablePrivate })}
                    />
                    <Toggle
                      label="Group"
                      on={inst.availableGroup}
                      disabled={busy === inst.id}
                      onClick={() => patch(inst.id, { availableGroup: !inst.availableGroup })}
                    />
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <NoteCell
                    inst={inst}
                    disabled={busy === inst.id}
                    onSave={(note) => patch(inst.id, { note })}
                  />
                </td>
                <td className="px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => patch(inst.id, { active: !inst.active })}
                    disabled={busy === inst.id}
                    className="flex items-center gap-1 text-[12px] font-semibold disabled:opacity-50"
                    style={{ color: inst.active ? 'var(--sage)' : 'var(--txt4)' }}
                  >
                    {inst.active ? <Check size={14} /> : <X size={14} />}
                    {inst.active ? 'Yes' : 'Hidden'}
                  </button>
                </td>
                <td className="px-4 py-2.5 text-right">
                  {confirmingDelete === inst.id ? (
                    <span className="inline-flex items-center gap-1.5 justify-end">
                      <span className="text-[11px]" style={{ color: 'var(--txt3)' }}>
                        Remove? Existing lessons are unaffected.
                      </span>
                      <button
                        type="button"
                        onClick={() => remove(inst)}
                        disabled={busy === inst.id}
                        className="px-2 py-1 rounded-lg text-[11px] font-bold text-white disabled:opacity-50"
                        style={{ background: 'var(--coral)' }}
                      >
                        Remove
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(null)}
                        className="px-2 py-1 rounded-lg text-[11px] font-semibold border"
                        style={{ borderColor: 'var(--bd2)' }}
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(inst.id)}
                      disabled={busy === inst.id}
                      aria-label={`Remove ${inst.name}`}
                      className="p-1.5 rounded-lg hover:bg-[var(--coral-lt)] disabled:opacity-50"
                      style={{ color: 'var(--coral)' }}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="Add an instrument (e.g. flute)"
          maxLength={80}
          className="flex-1 min-w-[200px] px-3 py-2 rounded-xl border text-sm outline-none focus:border-[var(--sage-md)]"
          style={{ borderColor: 'var(--bd2)' }}
        />
        <Toggle label="Private" on={isPrivate} onClick={() => setIsPrivate(!isPrivate)} />
        <Toggle label="Group" on={isGroup} onClick={() => setIsGroup(!isGroup)} />
        <button
          type="button"
          onClick={add}
          disabled={busy === 'add' || !name.trim()}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50"
          style={{ background: 'var(--sage)' }}
        >
          <Plus size={15} /> {busy === 'add' ? 'Adding…' : 'Add'}
        </button>
      </div>
    </div>
  );
}
