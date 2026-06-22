'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/badge';
import { Modal } from '@/components/modal';
import { SearchableSelect } from '@/components/searchable-select';
import { Plus, PoundSterling, Trash2 } from 'lucide-react';

interface Invoice {
  id: string; number: string; status: string; total: number; issuedOn: string; dueDate: string;
  mode: string; family: { id: string; name: string } | null;
}
interface Family { id: string; name: string; }
interface LineItem { description: string; amount: string; }

function CreateInvoiceModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyId, setFamilyId] = useState('');
  const [mode, setMode] = useState<'monthly_statement' | 'per_lesson' | 'custom'>('monthly_statement');
  const [lineItems, setLineItems] = useState<LineItem[]>([{ description: '', amount: '' }]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  useEffect(() => {
    if (open) {
      apiFetch<Family[]>('/families', { token: tok() }).then(setFamilies).catch(() => {});
      setFamilyId(''); setMode('monthly_statement');
      setLineItems([{ description: '', amount: '' }]); setError('');
    }
  }, [open]);

  function addLineItem() {
    setLineItems(items => [...items, { description: '', amount: '' }]);
  }

  function removeLineItem(idx: number) {
    setLineItems(items => items.filter((_, i) => i !== idx));
  }

  function updateLineItem(idx: number, field: keyof LineItem, value: string) {
    setLineItems(items => items.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!familyId) { setError('Please select a family'); return; }
    setSaving(true); setError('');
    try {
      const apiMode = mode === 'custom' ? 'per_lesson' : mode;
      const inv = await apiFetch<{ id: string }>('/invoices', {
        method: 'POST', token: tok(), body: JSON.stringify({
          familyId,
          mode: apiMode,
          periodStart: (e.currentTarget.elements.namedItem('periodStart') as HTMLInputElement)?.value || undefined,
          periodEnd: (e.currentTarget.elements.namedItem('periodEnd') as HTMLInputElement)?.value || undefined,
          notes: (e.currentTarget.elements.namedItem('notes') as HTMLTextAreaElement)?.value || undefined,
        }),
      });

      if (mode === 'custom' && lineItems.some(l => l.description && l.amount)) {
        for (const item of lineItems) {
          if (!item.description || !item.amount) continue;
          await apiFetch(`/invoices/${inv.id}/line-items`, {
            method: 'POST', token: tok(),
            body: JSON.stringify({
              description: item.description,
              amount: Math.round(parseFloat(item.amount) * 100),
            }),
          });
        }
      }

      onCreated(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create invoice">
      {error && (
        <div className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="ui-label">Family <span style={{ color: 'var(--coral)' }}>*</span></label>
          <SearchableSelect
            options={families.map(f => ({ value: f.id, label: f.name }))}
            value={familyId}
            onChange={setFamilyId}
            placeholder="Select family…"
          />
        </div>

        {/* Mode tabs */}
        <div>
          <label className="ui-label">Type</label>
          <div className="flex gap-1 p-1 rounded-xl border border-[var(--bd)]" style={{ background: 'var(--bg2)' }}>
            {([
              { key: 'monthly_statement', label: 'Monthly' },
              { key: 'per_lesson',        label: 'Per lesson' },
              { key: 'custom',            label: 'Custom amount' },
            ] as const).map(m => (
              <button
                key={m.key} type="button"
                onClick={() => setMode(m.key)}
                className="flex-1 text-sm py-1.5 rounded-lg font-semibold transition-all"
                style={{
                  background: mode === m.key ? 'white' : 'transparent',
                  color: mode === m.key ? 'var(--txt)' : 'var(--txt4)',
                  boxShadow: mode === m.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {mode !== 'custom' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="ui-label">Period start</label>
              <input name="periodStart" type="date" className="ui-input" />
            </div>
            <div>
              <label className="ui-label">Period end</label>
              <input name="periodEnd" type="date" className="ui-input" />
            </div>
          </div>
        )}

        {mode === 'custom' && (
          <div>
            <label className="ui-label">Line items <span style={{ color: 'var(--coral)' }}>*</span></label>
            <div className="space-y-2">
              {lineItems.map((item, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <input
                    value={item.description}
                    onChange={e => updateLineItem(idx, 'description', e.target.value)}
                    placeholder="Description"
                    className="ui-input flex-1"
                  />
                  <div className="relative shrink-0 w-28">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium" style={{ color: 'var(--txt3)' }}>£</span>
                    <input
                      value={item.amount}
                      onChange={e => updateLineItem(idx, 'amount', e.target.value)}
                      type="number" min="0.01" step="0.01"
                      placeholder="0.00"
                      className="ui-input pl-6 w-full"
                    />
                  </div>
                  {lineItems.length > 1 && (
                    <button type="button" onClick={() => removeLineItem(idx)}
                      className="shrink-0 p-1.5 rounded-lg hover:bg-[var(--coral-lt)] transition-colors"
                      style={{ color: 'var(--coral)' }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
              <button type="button" onClick={addLineItem}
                className="text-sm font-semibold hover:underline"
                style={{ color: 'var(--sage)' }}>
                + Add line item
              </button>
              {lineItems.some(l => l.amount) && (
                <p className="text-sm font-semibold pt-1" style={{ color: 'var(--txt)' }}>
                  Total: £{lineItems.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0).toFixed(2)}
                </p>
              )}
            </div>
          </div>
        )}

        <div>
          <label className="ui-label">Notes</label>
          <textarea name="notes" rows={2} className="ui-input" style={{ resize: 'vertical' }} />
        </div>
        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving} className="ui-btn-primary">
            {saving ? 'Creating…' : 'Create invoice'}
          </button>
          <button type="button" onClick={onClose} className="ui-btn-ghost">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

function RecordPaymentModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [families, setFamilies] = useState<Family[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [familyId, setFamilyId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [method, setMethod] = useState('bank_transfer');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  useEffect(() => {
    if (open) {
      apiFetch<Family[]>('/families', { token: tok() }).then(setFamilies).catch(() => {});
      setFamilyId(''); setInvoiceId(''); setMethod('bank_transfer'); setError('');
    }
  }, [open]);

  useEffect(() => {
    if (familyId) apiFetch<Invoice[]>(`/invoices?familyId=${familyId}`, { token: tok() })
      .then(i => setInvoices(i.filter(x => x.status === 'sent'))).catch(() => {});
    else setInvoices([]);
    setInvoiceId('');
  }, [familyId]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    try {
      await apiFetch('/payments', { method: 'POST', token: tok(), body: JSON.stringify({
        familyId,
        invoiceId: invoiceId || undefined,
        method,
        amount: Math.round(parseFloat(f.get('amount') as string) * 100),
        notes: f.get('notes') || undefined,
      })});
      onCreated(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Record payment">
      {error && (
        <div className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="ui-label">Family <span style={{ color: 'var(--coral)' }}>*</span></label>
          <SearchableSelect
            options={families.map(f => ({ value: f.id, label: f.name }))}
            value={familyId}
            onChange={setFamilyId}
            placeholder="Select family…"
          />
        </div>
        {invoices.length > 0 && (
          <div>
            <label className="ui-label">Apply to invoice</label>
            <SearchableSelect
              options={invoices.map(i => ({ value: i.id, label: `${i.number} — £${(i.total / 100).toFixed(2)}` }))}
              value={invoiceId}
              onChange={setInvoiceId}
              emptyLabel="No specific invoice"
            />
          </div>
        )}
        <div>
          <label className="ui-label">Method</label>
          <SearchableSelect
            options={[
              { value: 'bank_transfer', label: 'Bank transfer' },
              { value: 'cash',          label: 'Cash' },
              { value: 'card',          label: 'Card' },
              { value: 'gocardless',    label: 'GoCardless' },
              { value: 'revolut',       label: 'Revolut' },
              { value: 'other',         label: 'Other' },
            ]}
            value={method}
            onChange={setMethod}
          />
        </div>
        <div>
          <label className="ui-label">Amount (£) <span style={{ color: 'var(--coral)' }}>*</span></label>
          <input name="amount" type="number" min="0.01" step="0.01" required className="ui-input" />
        </div>
        <div>
          <label className="ui-label">Notes</label>
          <input name="notes" className="ui-input" />
        </div>
        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving} className="ui-btn-primary">
            {saving ? 'Saving…' : 'Record payment'}
          </button>
          <button type="button" onClick={onClose} className="ui-btn-ghost">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'default', sent: 'trial', paid: 'active', void: 'withdrawn',
};

export default function BillingPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  function load() {
    apiFetch<Invoice[]>('/invoices', { token: tok() }).then(setInvoices).catch(() => {});
  }
  useEffect(() => { load(); }, []);

  const outstanding = invoices.filter(i => i.status === 'sent').reduce((s, i) => s + i.total, 0);

  return (
    <div>
      <CreateInvoiceModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={load} />
      <RecordPaymentModal open={showPayment} onClose={() => setShowPayment(false)} onCreated={load} />
      <PageHeader
        title="Billing"
        subtitle={outstanding > 0 ? `£${(outstanding / 100).toFixed(2)} outstanding` : undefined}
        action={
          <div className="flex gap-2">
            <button onClick={() => setShowPayment(true)} className="ui-btn-ghost">
              <PoundSterling size={15} /> Record payment
            </button>
            <button onClick={() => setShowCreate(true)} className="ui-btn-primary">
              <Plus size={15} /> Create invoice
            </button>
          </div>
        }
      />

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Family</th>
              <th>Mode</th>
              <th>Issued</th>
              <th>Due</th>
              <th style={{ textAlign: 'right' }}>Total</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>
                No invoices yet.
              </td></tr>
            )}
            {invoices.map(i => (
              <tr key={i.id}>
                <td>
                  <Link href={`/app/billing/${i.id}`}
                    className="font-semibold hover:underline"
                    style={{ color: 'var(--sage-dk)' }}>
                    {i.number}
                  </Link>
                </td>
                <td>
                  {i.family
                    ? <Link href={`/app/families/${i.family.id}`} className="hover:underline" style={{ color: 'var(--txt2)' }}>{i.family.name}</Link>
                    : '—'}
                </td>
                <td className="text-xs capitalize" style={{ color: 'var(--txt3)' }}>{i.mode.replace(/_/g, ' ')}</td>
                <td style={{ color: 'var(--txt3)' }}>{i.issuedOn}</td>
                <td style={{ color: 'var(--txt3)' }}>{i.dueDate}</td>
                <td className="font-semibold" style={{ textAlign: 'right' }}>£{(i.total / 100).toFixed(2)}</td>
                <td><Badge variant={STATUS_COLORS[i.status]}>{i.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
