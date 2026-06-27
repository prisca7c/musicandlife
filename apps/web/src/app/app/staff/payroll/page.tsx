'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/badge';
import { Modal } from '@/components/modal';
import { SearchableSelect } from '@/components/searchable-select';
import { Paperclip } from 'lucide-react';

interface PayrollRun {
  id: string; status: string; periodStart: string; periodEnd: string;
  hoursElapsed: number; hourlyRate: number; gross: number;
  staff: { id: string; firstName: string; lastName: string } | null;
}
interface Expense {
  id: string; category: string; amount: number; date: string; description: string | null; status: string;
  staff: { id: string; firstName: string; lastName: string } | null;
  receiptFile: { id: string; originalName: string | null; mime: string } | null;
}
interface StaffMember { id: string; firstName: string; lastName: string; }

function CreateRunModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffId, setStaffId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  useEffect(() => {
    if (open) {
      apiFetch<StaffMember[]>('/staff', { token: tok() }).then(setStaff).catch(() => {});
      setStaffId(''); setError('');
    }
  }, [open]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    try {
      await apiFetch('/staff/payroll', { method: 'POST', token: tok(), body: JSON.stringify({
        staffId, periodStart: f.get('periodStart'), periodEnd: f.get('periodEnd'),
      })});
      onCreated(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Generate payroll run">
      {error && (
        <div className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}
      <p className="text-sm mb-5" style={{ color: 'var(--txt3)' }}>
        Calculates gross pay from completed lessons and late-cancellation fees in the period.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="ui-label">Staff member <span style={{ color: 'var(--coral)' }}>*</span></label>
          <SearchableSelect
            options={staff.map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
            value={staffId} onChange={setStaffId} placeholder="Select…"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ui-label">Period start <span style={{ color: 'var(--coral)' }}>*</span></label>
            <input name="periodStart" type="date" required
              defaultValue={(() => { const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()-1); return d.toISOString().split('T')[0]; })()}
              className="ui-input" />
          </div>
          <div>
            <label className="ui-label">Period end <span style={{ color: 'var(--coral)' }}>*</span></label>
            <input name="periodEnd" type="date" required
              defaultValue={(() => { const d=new Date(); d.setDate(0); return d.toISOString().split('T')[0]; })()}
              className="ui-input" />
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving} className="ui-btn-primary">
            {saving ? 'Generating…' : 'Generate'}
          </button>
          <button type="button" onClick={onClose} className="ui-btn-ghost">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

function AddExpenseModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [expStaffId, setExpStaffId] = useState('');
  const [category, setCategory] = useState('materials');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  useEffect(() => {
    if (open) {
      apiFetch<StaffMember[]>('/staff', { token: tok() }).then(setStaff).catch(() => {});
      setExpStaffId(''); setCategory('materials'); setReceipt(null); setError('');
    }
  }, [open]);

  async function uploadReceipt(file: File): Promise<string> {
    const { uploadUrl, fileId } = await apiFetch<{ uploadUrl: string; fileId: string }>('/files/sign-upload', {
      method: 'POST', token: tok(), body: JSON.stringify({ mime: file.type, size: file.size, originalName: file.name }),
    });
    await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
    return fileId;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    try {
      const receiptFileId = receipt ? await uploadReceipt(receipt) : undefined;
      await apiFetch('/expenses', { method: 'POST', token: tok(), body: JSON.stringify({
        staffId: expStaffId || undefined, category,
        amount: Math.round(parseFloat(f.get('amount') as string) * 100),
        date: f.get('date'), description: f.get('description') || undefined,
        mileageKm: f.get('mileageKm') ? parseInt(f.get('mileageKm') as string) : undefined,
        receiptFileId,
      })});
      onCreated(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add expense">
      {error && (
        <div className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="ui-label">Staff member</label>
          <SearchableSelect
            options={staff.map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
            value={expStaffId} onChange={setExpStaffId} emptyLabel="Studio expense"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ui-label">Category <span style={{ color: 'var(--coral)' }}>*</span></label>
            <SearchableSelect
              options={[
                { value: 'mileage', label: 'Mileage' }, { value: 'materials', label: 'Materials' },
                { value: 'equipment', label: 'Equipment' }, { value: 'training', label: 'Training' },
                { value: 'other', label: 'Other' },
              ]}
              value={category} onChange={setCategory}
            />
          </div>
          <div>
            <label className="ui-label">Date <span style={{ color: 'var(--coral)' }}>*</span></label>
            <input name="date" type="date" required className="ui-input" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ui-label">Amount (£) <span style={{ color: 'var(--coral)' }}>*</span></label>
            <input name="amount" type="number" min="0.01" step="0.01" required className="ui-input" />
          </div>
          <div>
            <label className="ui-label">Mileage (km)</label>
            <input name="mileageKm" type="number" min="0" className="ui-input" />
          </div>
        </div>
        <div>
          <label className="ui-label">Description</label>
          <input name="description" className="ui-input" />
        </div>
        <div>
          <label className="ui-label">Receipt</label>
          <input type="file" accept="image/*,.pdf" onChange={e => setReceipt(e.target.files?.[0] ?? null)} className="ui-input" />
        </div>
        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving} className="ui-btn-primary">
            {saving ? 'Saving…' : 'Add expense'}
          </button>
          <button type="button" onClick={onClose} className="ui-btn-ghost">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

export default function PayrollPage() {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [tab, setTab] = useState<'runs' | 'expenses'>('runs');
  const [showRun, setShowRun] = useState(false);
  const [showExpense, setShowExpense] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  function load() {
    apiFetch<PayrollRun[]>('/staff/payroll', { token: tok() }).then(setRuns).catch(() => {});
    apiFetch<Expense[]>('/expenses', { token: tok() }).then(setExpenses).catch(() => {});
  }
  useEffect(() => { load(); }, []);

  async function approveRun(id: string) {
    setActioning(id);
    try { await apiFetch(`/staff/payroll/${id}/approve`, { method: 'POST', token: tok() }); load(); }
    catch (e) { console.error(e); } finally { setActioning(null); }
  }

  async function openReceipt(fileId: string) {
    try {
      const { downloadUrl } = await apiFetch<{ downloadUrl: string }>(`/files/${fileId}/sign-download`, { token: tok() });
      window.open(downloadUrl, '_blank');
    } catch (e) { console.error(e); }
  }

  async function approveExpense(id: string) {
    setActioning(id);
    try { await apiFetch(`/expenses/${id}/approve`, { method: 'POST', token: tok() }); load(); }
    catch (e) { console.error(e); } finally { setActioning(null); }
  }

  const STATUS_COLORS: Record<string, string> = { draft:'default', approved:'trial', paid:'active', pending:'default', rejected:'withdrawn' };

  return (
    <div>
      <CreateRunModal open={showRun} onClose={() => setShowRun(false)} onCreated={load} />
      <AddExpenseModal open={showExpense} onClose={() => setShowExpense(false)} onCreated={load} />
      <PageHeader title="Payroll & Expenses" subtitle="Under Teachers &amp; Staff"
        action={
          <div className="flex gap-2">
            <button onClick={() => setShowExpense(true)} className="ui-btn-ghost">+ Add expense</button>
            <button onClick={() => setShowRun(true)} className="ui-btn-primary">+ Generate payroll run</button>
          </div>
        }
      />

      <div className="flex gap-1 mb-5 border-b" style={{ borderColor: 'var(--bd)' }}>
        {(['runs','expenses'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px capitalize transition-colors"
            style={{
              borderColor: tab === t ? 'var(--sage)' : 'transparent',
              color: tab === t ? 'var(--sage)' : 'var(--txt3)',
            }}>
            {t === 'runs' ? 'Payroll runs' : 'Expenses'}
          </button>
        ))}
      </div>

      {tab === 'runs' && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Staff member</th>
                <th>Period</th>
                <th style={{ textAlign: 'right' }}>Hours</th>
                <th style={{ textAlign: 'right' }}>Rate</th>
                <th style={{ textAlign: 'right' }}>Gross</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>
                  No payroll runs yet.
                </td></tr>
              )}
              {runs.map(r => (
                <tr key={r.id}>
                  <td className="font-semibold">{r.staff?.firstName} {r.staff?.lastName}</td>
                  <td className="text-xs" style={{ color: 'var(--txt3)' }}>{r.periodStart} → {r.periodEnd}</td>
                  <td style={{ textAlign: 'right' }}>{r.hoursElapsed}h</td>
                  <td style={{ textAlign: 'right', color: 'var(--txt3)' }}>£{(r.hourlyRate/100).toFixed(2)}/hr</td>
                  <td className="font-semibold" style={{ textAlign: 'right' }}>£{(r.gross/100).toFixed(2)}</td>
                  <td><Badge variant={STATUS_COLORS[r.status]}>{r.status}</Badge></td>
                  <td style={{ textAlign: 'right' }}>
                    {r.status === 'draft' && (
                      <button onClick={() => approveRun(r.id)} disabled={actioning===r.id}
                        className="text-xs font-semibold hover:underline disabled:opacity-50"
                        style={{ color: 'var(--sage)' }}>
                        Approve
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'expenses' && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Staff</th>
                <th>Category</th>
                <th>Date</th>
                <th>Description</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Status</th>
                <th>Receipt</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {expenses.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>
                  No expenses yet.
                </td></tr>
              )}
              {expenses.map(exp => (
                <tr key={exp.id}>
                  <td className="font-medium">{exp.staff ? `${exp.staff.firstName} ${exp.staff.lastName}` : 'Studio'}</td>
                  <td className="capitalize" style={{ color: 'var(--txt3)' }}>{exp.category}</td>
                  <td style={{ color: 'var(--txt3)' }}>{exp.date}</td>
                  <td className="text-xs" style={{ color: 'var(--txt4)' }}>{exp.description ?? '—'}</td>
                  <td className="font-semibold" style={{ textAlign: 'right' }}>£{(exp.amount/100).toFixed(2)}</td>
                  <td><Badge variant={STATUS_COLORS[exp.status]}>{exp.status}</Badge></td>
                  <td>
                    {exp.receiptFile ? (
                      <button onClick={() => openReceipt(exp.receiptFile!.id)}
                        className="flex items-center gap-1 text-xs font-semibold hover:underline" style={{ color: 'var(--sage)' }}>
                        <Paperclip size={12} /> View
                      </button>
                    ) : <span style={{ color: 'var(--txt4)' }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {exp.status === 'pending' && (
                      <button onClick={() => approveExpense(exp.id)} disabled={actioning===exp.id}
                        className="text-xs font-semibold hover:underline disabled:opacity-50"
                        style={{ color: 'var(--sage)' }}>
                        Approve
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
