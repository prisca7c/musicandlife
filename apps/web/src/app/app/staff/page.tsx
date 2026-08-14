'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { useApi } from '@/lib/swr';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/badge';
import { Modal } from '@/components/modal';
import { ALL_INSTRUMENTS } from '@music-life/types';
import { UserPlus } from 'lucide-react';

interface StaffMember { id: string; firstName: string; lastName: string; title: string | null; instruments: string[]; status: string; hourlyRate: number; payrollBalance: number; user: { email: string } | null; assignments: { id: string }[]; }

interface Colleague { id: string; firstName: string; lastName: string; title: string | null; phone: string | null; user: { email: string } | null; }

function getRoleFromToken(token?: string): string {
  try {
    if (!token) return '';
    const payload = JSON.parse(atob(token.split('.')[1]!));
    return payload.role ?? '';
  } catch { return ''; }
}

// Same underlying people, different lens: admins get the full staff record
// (pay, payroll balance, status) with add/manage actions; managers and
// teachers get a read-only name+contact directory — GET /staff/directory
// projects exactly those columns server-side, so this is UI routing only,
// not the privacy boundary itself.
function ColleaguesDirectory() {
  const { data: colleagues = [] } = useApi<Colleague[]>('/staff/directory');

  return (
    <div>
      <PageHeader title="Colleagues" subtitle={`${colleagues.length} teacher${colleagues.length !== 1 ? 's' : ''}`} />

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Title</th>
              <th>Email</th>
              <th>Phone</th>
            </tr>
          </thead>
          <tbody>
            {colleagues.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>
                No other teachers yet.
              </td></tr>
            )}
            {colleagues.map(c => (
              <tr key={c.id}>
                <td className="font-semibold" style={{ color: 'var(--sage-dk)' }}>{c.firstName} {c.lastName}</td>
                <td style={{ color: 'var(--txt3)' }}>{c.title ?? '—'}</td>
                <td style={{ color: 'var(--txt3)' }}>{c.user?.email ?? '—'}</td>
                <td style={{ color: 'var(--txt3)' }}>{c.phone ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AddStaffModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    const instruments = Array.from(f.getAll('instruments')) as string[];
    try {
      await apiFetch('/staff', { method: 'POST', token: tok(), body: JSON.stringify({
        firstName: f.get('firstName'), lastName: f.get('lastName'),
        email: f.get('email') || undefined, title: f.get('title') || undefined,
        phone: f.get('phone') || undefined, address: f.get('address') || undefined,
        instruments,
        hourlyRate: f.get('hourlyRate') ? Math.round(parseFloat(f.get('hourlyRate') as string) * 100) : 0,
        defaultDuration: parseInt(f.get('defaultDuration') as string) || 60,
      })});
      onCreated(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add staff member" maxWidth="max-w-xl">
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
          <label className="ui-label">
            Email{' '}
            <span className="font-normal text-[11px]" style={{ color: 'var(--txt4)' }}>(sends invite to set password)</span>
          </label>
          <input name="email" type="email" className="ui-input" />
        </div>
        <div>
          <label className="ui-label">Title</label>
          <input name="title" placeholder="e.g. Piano Teacher" className="ui-input" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ui-label">Phone</label>
            <input name="phone" className="ui-input" />
          </div>
          <div>
            <label className="ui-label">Address</label>
            <input name="address" className="ui-input" />
          </div>
        </div>
        <div>
          <label className="ui-label mb-2">Instruments</label>
          <div className="grid grid-cols-3 gap-1.5">
            {ALL_INSTRUMENTS.map(i => (
              <label key={i} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" name="instruments" value={i}
                  className="h-3.5 w-3.5 rounded"
                  style={{ accentColor: 'var(--sage)' }} />
                <span className="capitalize">{i}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ui-label">Hourly rate (£)</label>
            <input name="hourlyRate" type="number" min="0" step="0.01" defaultValue="45.00" className="ui-input" />
          </div>
          <div>
            <label className="ui-label">Default lesson (min)</label>
            <select name="defaultDuration" defaultValue="60" className="ui-input">
              <option value="30">30 min</option>
              <option value="45">45 min</option>
              <option value="60">60 min</option>
              <option value="90">90 min</option>
            </select>
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving} className="ui-btn-primary">
            {saving ? 'Saving…' : 'Add staff'}
          </button>
          <button type="button" onClick={onClose} className="ui-btn-ghost">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

export default function StaffPage() {
  const [showAdd, setShowAdd] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];
  const role = getRoleFromToken(tok());
  const isAdmin = role === 'admin';

  // Cached read — instant on revisit, revalidates in the background. Only
  // admins can call /staff (full record incl. pay); everyone else gets the
  // directory branch below, which never issues this request.
  const { data: staff = [], mutate } = useApi<StaffMember[]>(isAdmin ? '/staff' : null);
  const load = () => mutate();

  if (!isAdmin) return <ColleaguesDirectory />;

  return (
    <div>
      <AddStaffModal open={showAdd} onClose={() => setShowAdd(false)} onCreated={load} />
      <PageHeader
        title="Staff"
        subtitle={`${staff.length} staff member${staff.length !== 1 ? 's' : ''}`}
        action={
          <button onClick={() => setShowAdd(true)} className="ui-btn-primary">
            <UserPlus size={15} /> Add staff
          </button>
        }
      />

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Title</th>
              <th>Instruments</th>
              <th>Assigned</th>
              <th>Hourly rate</th>
              <th>Payroll balance</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {staff.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>
                No staff yet.
              </td></tr>
            )}
            {staff.map(s => (
              <tr key={s.id}>
                <td>
                  <Link href={`/app/staff/${s.id}`}
                    className="font-semibold hover:underline"
                    style={{ color: 'var(--sage-dk)' }}>
                    {s.firstName} {s.lastName}
                  </Link>
                  {s.user && <div className="text-xs mt-0.5" style={{ color: 'var(--txt4)' }}>{s.user.email}</div>}
                </td>
                <td style={{ color: 'var(--txt3)' }}>{s.title ?? '—'}</td>
                <td className="capitalize" style={{ color: 'var(--txt3)' }}>{s.instruments.join(', ') || '—'}</td>
                <td style={{ color: 'var(--txt3)' }}>{s.assignments.length}</td>
                <td className="font-medium">{formatMoney(s.hourlyRate)}/hr</td>
                <td className="font-medium">{formatMoney(s.payrollBalance)}</td>
                <td><Badge variant={s.status}>{s.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
