'use client';

import { useState, FormEvent } from 'react';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { Modal } from '@/components/modal';
import { InfoTooltip } from '@/components/info-tooltip';

interface CreditBalance {
  total: number;
  prepaid: number;
  makeup: number;
  used: number;
  everIssued: number;
}

function AddCreditsModal({ open, onClose, studentId, onSaved }: {
  open: boolean; onClose: () => void; studentId: string; onSaved: () => void;
}) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    try {
      await apiFetch(`/students/${studentId}/credits`, {
        method: 'POST', token: tok(),
        body: JSON.stringify({ count: parseInt(f.get('count') as string, 10), type: f.get('type') }),
      });
      onSaved(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add credits">
      {error && <p className="mb-3 text-sm text-[var(--coral)] bg-[var(--coral-lt)] border border-[var(--coral)] rounded-xl px-3 py-2">{error}</p>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs" style={{ color: 'var(--txt4)' }}>
          Use this when a family pays outside the portal — cash, bank transfer, or anything else not captured automatically. Online prepayments already add credits on their own.
        </p>
        <div>
          <label className="block text-xs font-semibold text-[var(--txt2)] mb-1.5">Number of lessons</label>
          <input name="count" type="number" min="1" max="100" required autoFocus defaultValue="1"
            className="w-full border-[1.5px] border-[var(--bd2)] rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-[var(--sage)]" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-[var(--txt2)] mb-1.5">Type</label>
          <select name="type" defaultValue="prepaid"
            className="w-full border-[1.5px] border-[var(--bd2)] rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-[var(--sage)]">
            <option value="prepaid">Prepaid (paid for upfront)</option>
            <option value="makeup">Makeup (goodwill, no charge)</option>
          </select>
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving}
            className="bg-[var(--sage)] text-white rounded-xl px-5 py-2.5 text-sm font-bold hover:bg-[var(--sage-dk)] disabled:opacity-50">
            {saving ? 'Adding…' : 'Add credits'}
          </button>
          <button type="button" onClick={onClose} className="rounded-xl px-5 py-2.5 text-sm border border-[var(--bd2)] hover:bg-[var(--surf)]">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

/** Available/used lesson-credit balance for one student, with an admin-only
 * "Add credits" action for cash/off-platform payments — online prepayment
 * already credits automatically via billing.service.ts. */
export function StudentCreditsCard({ studentId, role }: { studentId: string; role: string }) {
  const [showAdd, setShowAdd] = useState(false);
  const { data: balance, mutate } = useApi<CreditBalance>(`/students/${studentId}/credits`);

  return (
    <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
      <AddCreditsModal open={showAdd} onClose={() => setShowAdd(false)} studentId={studentId} onSaved={() => mutate()} />
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-sm uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--txt3)' }}>
          Lesson credits
          <InfoTooltip text="Credits paid for upfront (cash or online) or earned from a cancelled lesson. Booking a lesson with a credit uses it up." />
        </h2>
        {role === 'admin' && (
          <button onClick={() => setShowAdd(true)} className="text-[11px] font-semibold hover:underline" style={{ color: 'var(--sage)' }}>
            Add credits
          </button>
        )}
      </div>
      {!balance ? (
        <p className="text-sm" style={{ color: 'var(--txt4)' }}>Loading…</p>
      ) : (
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt style={{ color: 'var(--txt3)' }}>Available</dt>
            <dd className="font-bold" style={{ color: balance.total > 0 ? 'var(--sage-dk)' : 'var(--txt)' }}>{balance.total}</dd>
          </div>
          <div className="flex justify-between gap-3 text-xs" style={{ color: 'var(--txt4)' }}>
            <dt className="pl-2">— prepaid</dt>
            <dd>{balance.prepaid}</dd>
          </div>
          <div className="flex justify-between gap-3 text-xs" style={{ color: 'var(--txt4)' }}>
            <dt className="pl-2">— makeup</dt>
            <dd>{balance.makeup}</dd>
          </div>
          <div className="flex justify-between gap-3 pt-1 border-t" style={{ borderColor: 'var(--bd)' }}>
            <dt style={{ color: 'var(--txt3)' }}>Already booked</dt>
            <dd className="font-medium">{balance.used}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt style={{ color: 'var(--txt3)' }}>Ever issued</dt>
            <dd className="font-medium">{balance.everIssued}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
