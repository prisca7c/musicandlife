'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { Modal } from '@/components/modal';
import { UsersRound, Search } from 'lucide-react';

interface Family {
  id: string; name: string; contactName: string | null; email: string | null;
  balanceCached: number; invoiceMode: string;
  students: { id: string; status: string }[];
}

function AddFamilyModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    try {
      await apiFetch('/families', { method: 'POST', token: tok(), body: JSON.stringify({
        name: f.get('name'), contactName: f.get('contactName') || undefined,
        phone: f.get('phone') || undefined, email: f.get('email') || undefined,
        address: f.get('address') || undefined, invoiceMode: f.get('invoiceMode'),
      })});
      onCreated(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add family">
      {error && (
        <div className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="ui-label">Family name <span style={{ color: 'var(--coral)' }}>*</span></label>
          <input name="name" required className="ui-input" />
        </div>
        <div>
          <label className="ui-label">Primary contact name</label>
          <input name="contactName" className="ui-input" />
        </div>
        <div>
          <label className="ui-label">Email</label>
          <input name="email" type="email" className="ui-input" />
        </div>
        <div>
          <label className="ui-label">Phone</label>
          <input name="phone" className="ui-input" />
        </div>
        <div>
          <label className="ui-label">Address</label>
          <textarea name="address" rows={2} className="ui-input" style={{ resize: 'vertical' }} />
        </div>
        <div>
          <label className="ui-label">Invoice mode</label>
          <select name="invoiceMode" className="ui-input">
            <option value="monthly_statement">Monthly statement</option>
            <option value="per_lesson">Per lesson</option>
          </select>
        </div>
        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving} className="ui-btn-primary">
            {saving ? 'Saving…' : 'Add family'}
          </button>
          <button type="button" onClick={onClose} className="ui-btn-ghost">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

export default function FamiliesPage() {
  const [families, setFamilies] = useState<Family[]>([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  function load(q = search) {
    const qs = q ? `?search=${encodeURIComponent(q)}` : '';
    apiFetch<Family[]>(`/families${qs}`, { token: tok() }).then(setFamilies).catch(() => {});
  }

  useEffect(() => { load(); }, []);

  return (
    <div>
      <AddFamilyModal open={showAdd} onClose={() => setShowAdd(false)} onCreated={() => load()} />
      <PageHeader
        title="Families"
        subtitle={`${families.length} famil${families.length !== 1 ? 'ies' : 'y'}`}
        action={
          <button onClick={() => setShowAdd(true)} className="ui-btn-primary">
            <UsersRound size={15} /> Add family
          </button>
        }
      />

      <div className="mb-5 relative">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: 'var(--txt4)' }}>
          <Search size={15} />
        </span>
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); load(e.target.value); }}
          placeholder="Search by name or email…"
          className="ui-search pl-9"
        />
      </div>

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Family</th>
              <th>Contact</th>
              <th>Students</th>
              <th>Balance</th>
              <th>Invoicing</th>
            </tr>
          </thead>
          <tbody>
            {families.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>
                No families yet.
              </td></tr>
            )}
            {families.map(f => (
              <tr key={f.id}>
                <td>
                  <Link href={`/app/families/${f.id}`}
                    className="font-semibold hover:underline"
                    style={{ color: 'var(--sage-dk)' }}>
                    {f.name}
                  </Link>
                </td>
                <td style={{ color: 'var(--txt3)' }}>{f.contactName ?? '—'}</td>
                <td className="font-medium">{f.students.length}</td>
                <td>
                  <span style={{ color: f.balanceCached < 0 ? 'var(--coral)' : 'var(--txt2)' }}
                    className={f.balanceCached < 0 ? 'font-semibold' : ''}>
                    £{(Math.abs(f.balanceCached) / 100).toFixed(2)}{f.balanceCached < 0 ? ' owed' : ''}
                  </span>
                </td>
                <td className="text-xs capitalize" style={{ color: 'var(--txt3)' }}>
                  {f.invoiceMode.replace('_', ' ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
