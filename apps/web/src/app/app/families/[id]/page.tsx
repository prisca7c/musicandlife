'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/badge';
import { Modal } from '@/components/modal';
import { BackButton } from '@/components/back-button';

interface FamilyDetail {
  id: string; name: string; contactName: string | null; address: string | null;
  phone: string | null; email: string | null; autoInvoice: boolean;
  invoiceMode: string; balanceCached: number;
  students: { id: string; firstName: string; lastName: string; status: string }[];
  guardians: { id: string; relationship: string; user: { id: string; email: string } }[];
}

// Add student — family pre-filled, no need to select it
function AddStudentModal({ open, onClose, familyId, familyName, onCreated }: {
  open: boolean; onClose: () => void; familyId: string; familyName: string; onCreated: () => void;
}) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    try {
      await apiFetch('/students', { method: 'POST', token: tok(), body: JSON.stringify({
        familyId, firstName: f.get('firstName'), lastName: f.get('lastName'),
        dob: f.get('dob') || undefined, email: f.get('email') || undefined,
        status: f.get('status'), notes: f.get('notes') || undefined,
      })});
      onCreated(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Add student — ${familyName}`}>
      {error && (
        <div className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ui-label">First name <span style={{ color: 'var(--coral)' }}>*</span></label>
            <input name="firstName" required autoFocus className="ui-input" />
          </div>
          <div>
            <label className="ui-label">Last name <span style={{ color: 'var(--coral)' }}>*</span></label>
            <input name="lastName" required className="ui-input" />
          </div>
        </div>
        <div>
          <label className="ui-label">Date of birth</label>
          <input name="dob" type="date" className="ui-input" />
        </div>
        <div>
          <label className="ui-label">
            Student email{' '}
            <span className="font-normal text-[11px]" style={{ color: 'var(--txt4)' }}>(optional — creates portal login)</span>
          </label>
          <input name="email" type="email" className="ui-input" />
        </div>
        <div>
          <label className="ui-label">Status</label>
          <select name="status" defaultValue="active" className="ui-input">
            <option value="trial">Trial</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </div>
        <div>
          <label className="ui-label">Notes</label>
          <textarea name="notes" rows={2} className="ui-input" style={{ resize: 'vertical' }} />
        </div>
        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving} className="ui-btn-primary">
            {saving ? 'Saving…' : 'Add student'}
          </button>
          <button type="button" onClick={onClose} className="ui-btn-ghost">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

// Create invoice — family pre-filled
function CreateInvoiceModal({ open, onClose, familyId, familyName, invoiceMode, onCreated }: {
  open: boolean; onClose: () => void; familyId: string; familyName: string; invoiceMode: string; onCreated: () => void;
}) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];
  const lastMonthStart = new Date(); lastMonthStart.setDate(1); lastMonthStart.setMonth(lastMonthStart.getMonth()-1);
  const lastMonthEnd = new Date(); lastMonthEnd.setDate(0);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    try {
      const inv = await apiFetch<{id:string}>('/invoices', { method: 'POST', token: tok(), body: JSON.stringify({
        familyId, mode: f.get('mode'),
        periodStart: f.get('periodStart') || undefined, periodEnd: f.get('periodEnd') || undefined,
        notes: f.get('notes') || undefined,
      })});
      onCreated(); onClose();
      window.location.href = `/app/billing/${inv.id}`;
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Create invoice — ${familyName}`}>
      {error && (
        <div className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="ui-label">Mode</label>
          <select name="mode" defaultValue={invoiceMode} className="ui-input">
            <option value="monthly_statement">Monthly statement</option>
            <option value="per_lesson">Per lesson</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ui-label">Period start</label>
            <input name="periodStart" type="date" defaultValue={lastMonthStart.toISOString().split('T')[0]} className="ui-input" />
          </div>
          <div>
            <label className="ui-label">Period end</label>
            <input name="periodEnd" type="date" defaultValue={lastMonthEnd.toISOString().split('T')[0]} className="ui-input" />
          </div>
        </div>
        <div>
          <label className="ui-label">Notes</label>
          <textarea name="notes" rows={2} className="ui-input" style={{ resize: 'vertical' }} />
        </div>
        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving} className="ui-btn-primary">
            {saving ? 'Creating…' : 'Create & open invoice'}
          </button>
          <button type="button" onClick={onClose} className="ui-btn-ghost">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

export default function FamilyDetailPage() {
  const params = useParams<{ id: string }>();
  const [family, setFamily] = useState<FamilyDetail | null>(null);
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [showCreateInvoice, setShowCreateInvoice] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  function load() {
    apiFetch<FamilyDetail>(`/families/${params.id}`, { token: tok() }).then(setFamily).catch(() => {});
  }
  useEffect(() => { load(); }, [params.id]);

  if (!family) return <div className="p-8 text-center text-sm" style={{ color: 'var(--txt4)' }}>Loading…</div>;

  return (
    <div>
      {family && <AddStudentModal open={showAddStudent} onClose={() => setShowAddStudent(false)}
        familyId={family.id} familyName={family.name} onCreated={load} />}
      {family && <CreateInvoiceModal open={showCreateInvoice} onClose={() => setShowCreateInvoice(false)}
        familyId={family.id} familyName={family.name} invoiceMode={family.invoiceMode} onCreated={load} />}

      <div className="mb-5">
        <BackButton label="Families" fallbackHref="/app/families" />
      </div>
      <PageHeader
        title={family.name} subtitle={family.contactName ?? undefined}
        action={
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold"
              style={{ color: family.balanceCached < 0 ? 'var(--coral)' : 'var(--txt3)' }}>
              Balance: £{(Math.abs(family.balanceCached) / 100).toFixed(2)}{family.balanceCached < 0 ? ' owed' : ''}
            </span>
            <button onClick={() => setShowCreateInvoice(true)} className="ui-btn-ghost text-sm">
              Create invoice
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
            <h2 className="font-bold mb-4 text-sm uppercase tracking-wider" style={{ color: 'var(--txt3)' }}>Contact</h2>
            <dl className="space-y-3 text-sm">
              {family.email && (
                <div className="flex justify-between gap-3">
                  <dt style={{ color: 'var(--txt3)' }}>Email</dt>
                  <dd className="font-medium text-right">{family.email}</dd>
                </div>
              )}
              {family.phone && (
                <div className="flex justify-between gap-3">
                  <dt style={{ color: 'var(--txt3)' }}>Phone</dt>
                  <dd className="font-medium">{family.phone}</dd>
                </div>
              )}
              {family.address && (
                <div>
                  <dt className="mb-1" style={{ color: 'var(--txt3)' }}>Address</dt>
                  <dd className="font-medium leading-snug">{family.address}</dd>
                </div>
              )}
            </dl>
          </div>
          <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
            <h2 className="font-bold mb-4 text-sm uppercase tracking-wider" style={{ color: 'var(--txt3)' }}>Billing</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt style={{ color: 'var(--txt3)' }}>Invoice mode</dt>
                <dd className="font-medium capitalize">{family.invoiceMode.replace('_', ' ')}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: 'var(--txt3)' }}>Auto-invoice</dt>
                <dd className="font-medium">{family.autoInvoice ? 'Yes' : 'No'}</dd>
              </div>
            </dl>
            <Link href={`/app/billing?familyId=${family.id}`}
              className="mt-4 block text-sm font-semibold hover:underline"
              style={{ color: 'var(--sage)' }}>
              View invoices →
            </Link>
          </div>
          {family.guardians.length > 0 && (
            <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
              <h2 className="font-bold mb-4 text-sm uppercase tracking-wider" style={{ color: 'var(--txt3)' }}>Guardians</h2>
              <ul className="space-y-3 text-sm">
                {family.guardians.map(g => (
                  <li key={g.id} className="flex justify-between gap-3">
                    <span className="capitalize" style={{ color: 'var(--txt3)' }}>{g.relationship}</span>
                    <span className="font-medium">{g.user.email}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          <div className="data-table-wrap overflow-hidden">
            <div className="px-5 py-3.5 border-b flex items-center justify-between"
              style={{ borderColor: 'var(--bd)', background: 'var(--surf)' }}>
              <h2 className="font-bold text-sm" style={{ color: 'var(--txt)' }}>
                Students ({family.students.length})
              </h2>
              <button onClick={() => setShowAddStudent(true)} className="ui-btn-primary text-xs px-3 py-1.5">
                + Add student
              </button>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {family.students.length === 0 && (
                  <tr><td colSpan={2} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>
                    No students yet.
                  </td></tr>
                )}
                {family.students.map(s => (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/app/students/${s.id}`}
                        className="font-semibold hover:underline"
                        style={{ color: 'var(--sage-dk)' }}>
                        {s.firstName} {s.lastName}
                      </Link>
                    </td>
                    <td><Badge variant={s.status}>{s.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
