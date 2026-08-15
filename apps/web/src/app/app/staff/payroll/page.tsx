'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { studioDayString } from '@/lib/datetime';
import { useApi } from '@/lib/swr';
import { PageHeader } from '@/components/page-header';
import { InfoTooltip } from '@/components/info-tooltip';
import { Badge } from '@/components/badge';
import { Modal } from '@/components/modal';
import { SearchableSelect } from '@/components/searchable-select';
import { SectionTabs } from '@/components/section-tabs';
import { Paperclip } from 'lucide-react';

const SECTION_ITEMS = [
  { label: 'Billing', href: '/app/billing' },
  { label: 'Payments', href: '/app/billing/reconciliation' },
  { label: 'Payroll', href: '/app/staff/payroll' },
];

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

// Default payroll period = this month so far. Lessons only become payable once
// their attendance is marked (present → completed), so defaulting to *last*
// month used to hide this month's lessons and the run came back empty.
const monthStartISO = () => `${studioDayString(new Date()).slice(0, 7)}-01`;
const todayISO = () => studioDayString(new Date());

// Shown on both payroll modals: explains why a run can come back empty.
const PAYROLL_HINT = 'Only lessons marked as completed (attendance taken) count. Overdue lessons auto-complete about a day later when that automation is on — until then, mark attendance so they appear here.';

function CreateRunModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [staffId, setStaffId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  // Staff options — only fetched while the modal is open; cached across opens.
  const { data: staff = [] } = useApi<StaffMember[]>(open ? '/staff' : null);
  useEffect(() => {
    if (open) { setStaffId(''); setError(''); }
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
      <p className="text-sm mb-2" style={{ color: 'var(--txt3)' }}>
        Calculates gross pay from completed lessons and late-cancellation fees in the period.
      </p>
      <p className="text-xs mb-5" style={{ color: 'var(--txt4)' }}>{PAYROLL_HINT}</p>
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
            <label htmlFor="run-period-start" className="ui-label">Period start <span style={{ color: 'var(--coral)' }}>*</span></label>
            <input id="run-period-start" name="periodStart" type="date" required defaultValue={monthStartISO()} className="ui-input" />
          </div>
          <div>
            <label htmlFor="run-period-end" className="ui-label">Period end <span style={{ color: 'var(--coral)' }}>*</span></label>
            <input id="run-period-end" name="periodEnd" type="date" required defaultValue={todayISO()} className="ui-input" />
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

interface RunAllResult {
  staffConsidered: number;
  created: { staffId: string; name: string; runId: string; gross: number; items: number }[];
  skippedExisting: number;
  skippedEmpty: number;
}

function RunAllModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<RunAllResult | null>(null);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  useEffect(() => {
    if (open) { setError(''); setResult(null); }
  }, [open]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    try {
      const res = await apiFetch<RunAllResult>('/staff/payroll/run-all', { method: 'POST', token: tok(), body: JSON.stringify({
        periodStart: f.get('periodStart'), periodEnd: f.get('periodEnd'),
      })});
      setResult(res); onCreated();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Run payroll for all staff">
      {error && (
        <div className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}
      {result ? (
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--txt2)' }}>
            Drafted <strong>{result.created.length}</strong> payroll run{result.created.length !== 1 ? 's' : ''} across{' '}
            {result.staffConsidered} active staff.
            {result.skippedExisting > 0 && ` ${result.skippedExisting} already had a run for this period.`}
            {result.skippedEmpty > 0 && ` ${result.skippedEmpty} had no payable lessons.`}
          </p>
          {result.created.length === 0 && (
            <div className="text-sm rounded-xl px-4 py-3" style={{ background: 'var(--surf)', color: 'var(--txt3)', border: '1px solid var(--bd)' }}>
              Nothing to draft for this period. {PAYROLL_HINT} You can also widen the dates above if the lessons happened earlier.
            </div>
          )}
          {result.created.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--bd)' }}>
              {result.created.map(c => (
                <div key={c.runId} className="flex items-center justify-between px-3.5 py-2 text-sm border-b last:border-b-0"
                  style={{ borderColor: 'var(--bd)' }}>
                  <span className="font-medium">{c.name}</span>
                  <span style={{ color: 'var(--txt3)' }}>{c.items} lesson{c.items !== 1 ? 's' : ''} · <strong style={{ color: 'var(--txt2)' }}>{formatMoney(c.gross)}</strong></span>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs" style={{ color: 'var(--txt4)' }}>
            All drafts appear in the list below for review before you approve them.
          </p>
          <button type="button" onClick={onClose} className="ui-btn-primary">Done</button>
        </div>
      ) : (
        <>
          <p className="text-sm mb-2" style={{ color: 'var(--txt3)' }}>
            Drafts one payroll run per active teacher from their completed lessons and late-cancellations in the period.
            Teachers with no payable lessons, or who already have a run for this exact period, are skipped — so it&apos;s safe to re-run.
          </p>
          <p className="text-xs mb-5" style={{ color: 'var(--txt4)' }}>{PAYROLL_HINT}</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="run-all-period-start" className="ui-label">Period start <span style={{ color: 'var(--coral)' }}>*</span></label>
                <input id="run-all-period-start" name="periodStart" type="date" required defaultValue={monthStartISO()} className="ui-input" />
              </div>
              <div>
                <label htmlFor="run-all-period-end" className="ui-label">Period end <span style={{ color: 'var(--coral)' }}>*</span></label>
                <input id="run-all-period-end" name="periodEnd" type="date" required defaultValue={todayISO()} className="ui-input" />
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button type="submit" disabled={saving} className="ui-btn-primary">
                {saving ? 'Running…' : 'Run all'}
              </button>
              <button type="button" onClick={onClose} className="ui-btn-ghost">Cancel</button>
            </div>
          </form>
        </>
      )}
    </Modal>
  );
}

function AddExpenseModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [expStaffId, setExpStaffId] = useState('');
  const [category, setCategory] = useState('materials');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  // Staff options — only fetched while the modal is open; cached across opens.
  const { data: staff = [] } = useApi<StaffMember[]>(open ? '/staff' : null);
  useEffect(() => {
    if (open) { setExpStaffId(''); setCategory('materials'); setReceipt(null); setError(''); }
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
            <label htmlFor="expense-date" className="ui-label">Date <span style={{ color: 'var(--coral)' }}>*</span></label>
            <input id="expense-date" name="date" type="date" required className="ui-input" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="expense-amount" className="ui-label">Amount (£) <span style={{ color: 'var(--coral)' }}>*</span></label>
            <input id="expense-amount" name="amount" type="number" min="0.01" step="0.01" required className="ui-input" />
          </div>
          <div>
            <label htmlFor="expense-mileage" className="ui-label">Mileage (km)</label>
            <input id="expense-mileage" name="mileageKm" type="number" min="0" className="ui-input" />
          </div>
        </div>
        <div>
          <label htmlFor="expense-description" className="ui-label">Description</label>
          <input id="expense-description" name="description" className="ui-input" />
        </div>
        <div>
          <label htmlFor="expense-receipt" className="ui-label">Receipt</label>
          <input id="expense-receipt" type="file" accept="image/*,.pdf" onChange={e => setReceipt(e.target.files?.[0] ?? null)} className="ui-input" />
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
  const [tab, setTab] = useState<'runs' | 'expenses'>('runs');
  const [showRun, setShowRun] = useState(false);
  const [showRunAll, setShowRunAll] = useState(false);
  const [showExpense, setShowExpense] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  // Cached reads — instant on revisit. load() refreshes both after an action.
  const { data: runs = [], mutate: mutateRuns } = useApi<PayrollRun[]>('/staff/payroll');
  const { data: expenses = [], mutate: mutateExpenses } = useApi<Expense[]>('/expenses');
  const load = () => { mutateRuns(); mutateExpenses(); };

  async function approveRun(id: string) {
    const run = runs.find(r => r.id === id);
    const who = run?.staff ? `${run.staff.firstName} ${run.staff.lastName}` : 'this run';
    if (!confirm(`Approve ${who}'s payroll run${run ? ` (${formatMoney(run.gross)})` : ''}? This locks the figures in — there's no way to un-approve it from here.`)) return;
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
    const exp = expenses.find(e => e.id === id);
    const who = exp?.staff ? `${exp.staff.firstName} ${exp.staff.lastName}` : 'this expense';
    if (!confirm(`Approve ${who}'s expense${exp ? ` (${formatMoney(exp.amount)})` : ''}? There's no way to un-approve it from here.`)) return;
    setActioning(id);
    try { await apiFetch(`/expenses/${id}/approve`, { method: 'POST', token: tok() }); load(); }
    catch (e) { console.error(e); } finally { setActioning(null); }
  }

  const STATUS_COLORS: Record<string, string> = { draft:'draft', approved:'approved', paid:'paid', pending:'pending', rejected:'denied' };

  return (
    <div>
      <CreateRunModal open={showRun} onClose={() => setShowRun(false)} onCreated={load} />
      <RunAllModal open={showRunAll} onClose={() => setShowRunAll(false)} onCreated={load} />
      <AddExpenseModal open={showExpense} onClose={() => setShowExpense(false)} onCreated={load} />
      <SectionTabs items={SECTION_ITEMS} />
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Payroll &amp; Expenses
            <InfoTooltip text="A payroll run totals each teacher's completed lessons over a period at their pay rate, plus any approved expenses. Nothing is paid out automatically — it's a summary you review and action outside the platform." />
          </span>
        }
        subtitle="Under Teachers &amp; Staff"
        action={
          <div className="flex gap-2">
            <button onClick={() => setShowExpense(true)} className="ui-btn-ghost">+ Add expense</button>
            <button onClick={() => setShowRun(true)} className="ui-btn-ghost">+ One teacher</button>
            <button onClick={() => setShowRunAll(true)} className="ui-btn-primary">Run all staff</button>
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
                  <td style={{ textAlign: 'right', color: 'var(--txt3)' }}>{formatMoney(r.hourlyRate)}/hr</td>
                  <td className="font-semibold" style={{ textAlign: 'right' }}>{formatMoney(r.gross)}</td>
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
                  <td className="font-semibold" style={{ textAlign: 'right' }}>{formatMoney(exp.amount)}</td>
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
