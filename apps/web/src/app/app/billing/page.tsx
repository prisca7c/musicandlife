'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { formatMoney } from '@/lib/money';
import { PageHeader } from '@/components/page-header';
import { InfoTooltip } from '@/components/info-tooltip';
import { AutomatedHint } from '@/components/automated-hint';
import { Badge } from '@/components/badge';
import { PaidDot } from '@/components/paid-dot';
import { Modal } from '@/components/modal';
import { SearchableSelect } from '@/components/searchable-select';
import { SectionTabs } from '@/components/section-tabs';
import { Plus, PoundSterling, Trash2 } from 'lucide-react';
import { invoiceStatusLabel, invoiceStatusColor } from '@/lib/invoice-status';

// Payments and Payroll no longer have their own sidebar entries — they live
// "under" Billing, reached via this tab strip instead.
const SECTION_ITEMS = [
  { label: 'Billing', href: '/app/billing' },
  { label: 'Payments', href: '/app/billing/reconciliation' },
  { label: 'Payroll', href: '/app/staff/payroll' },
];

interface Invoice {
  id: string; number: string; status: string; total: number; issuedOn: string; dueDate: string;
  mode: string; family: { id: string; name: string; contactName: string | null } | null;
}
interface Family {
  id: string; name: string; contactName?: string | null;
  students?: { id: string; firstName: string; lastName: string }[];
}
interface Term { id: string; name: string; startsOn: string; endsOn: string; }
interface LineItem { description: string; amount: string; }

// Two families both named "Mistry Family" are indistinguishable in a plain
// name dropdown — lead with the parent/adult's actual name (contactName),
// and list the kids so the picker still disambiguates when contactName isn't
// set either.
function familyLabel(f: Family): string {
  const who = f.contactName?.trim() || f.name;
  const kids = (f.students ?? []).map(s => s.firstName).filter(Boolean).join(', ');
  return kids ? `${who} (${kids})` : who;
}

function CreateInvoiceModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyId, setFamilyId] = useState('');
  const [mode, setMode] = useState<'monthly_statement' | 'per_lesson' | 'custom'>('monthly_statement');
  const [lineItems, setLineItems] = useState<LineItem[]>([{ description: '', amount: '' }]);
  const [splitByClass, setSplitByClass] = useState(false);
  const [terms, setTerms] = useState<Term[]>([]);
  const [termId, setTermId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  useEffect(() => {
    if (open) {
      apiFetch<Family[]>('/families', { token: tok() }).then(setFamilies).catch(() => {});
      apiFetch<Term[]>('/terms', { token: tok() }).then(setTerms).catch(() => {});
      setFamilyId(''); setMode('monthly_statement');
      setLineItems([{ description: '', amount: '' }]); setSplitByClass(false); setError('');
      setTermId(''); setPeriodStart(''); setPeriodEnd('');
    }
  }, [open]);

  function pickTerm(id: string) {
    setTermId(id);
    const t = terms.find(x => x.id === id);
    if (t) { setPeriodStart(t.startsOn); setPeriodEnd(t.endsOn); }
  }

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
      const start = periodStart || undefined;
      const end = periodEnd || undefined;

      // "Separate invoice per class" raises one invoice per enrolment for the
      // period instead of a single combined statement. Not available for the
      // custom (manual line items) flow, which has no lessons to split.
      if (splitByClass && mode !== 'custom') {
        const res = await apiFetch<{ invoices: unknown[] }>('/invoices/split-by-class', {
          method: 'POST', token: tok(), body: JSON.stringify({ familyId, mode: apiMode, periodStart: start, periodEnd: end, termId: termId || undefined }),
        });
        if (!res.invoices?.length) throw new Error('No unbilled lessons in this period to invoice.');
        onCreated(); onClose();
        return;
      }

      const inv = await apiFetch<{ id: string }>('/invoices', {
        method: 'POST', token: tok(), body: JSON.stringify({
          familyId,
          mode: apiMode,
          // Custom invoices are manual-only — don't auto-pull the period's lessons.
          itemizeLessons: mode !== 'custom',
          termId: termId || undefined,
          periodStart: start,
          periodEnd: end,
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
            options={families.map(f => ({ value: f.id, label: familyLabel(f) }))}
            value={familyId}
            onChange={setFamilyId}
            placeholder="Select family…"
          />
        </div>

        {mode !== 'custom' && terms.length > 0 && (
          <div>
            <label className="ui-label">Term</label>
            <SearchableSelect
              options={terms.map(t => ({ value: t.id, label: t.name }))}
              value={termId}
              onChange={pickTerm}
              placeholder="No term — use dates below…"
              emptyLabel="No term — use dates below"
            />
          </div>
        )}

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
              <input name="periodStart" type="date" className="ui-input" value={periodStart}
                onChange={e => { setPeriodStart(e.target.value); setTermId(''); }} />
            </div>
            <div>
              <label className="ui-label">Period end</label>
              <input name="periodEnd" type="date" className="ui-input" value={periodEnd}
                onChange={e => { setPeriodEnd(e.target.value); setTermId(''); }} />
            </div>
          </div>
        )}

        {mode !== 'custom' && (
          <label className="flex items-start gap-2.5 cursor-pointer rounded-xl border border-[var(--bd)] px-3 py-2.5"
            style={{ background: splitByClass ? 'var(--sage-lt)' : 'transparent' }}>
            <input type="checkbox" checked={splitByClass} onChange={e => setSplitByClass(e.target.checked)}
              className="mt-0.5 accent-[var(--sage)]" />
            <span className="text-sm">
              <span className="font-semibold" style={{ color: 'var(--txt)' }}>Separate invoice per class</span>
              <span className="block text-xs mt-0.5" style={{ color: 'var(--txt3)' }}>
                One invoice per instrument/class instead of a single combined statement — e.g. a child doing piano and cello gets two bills.
              </span>
            </span>
          </label>
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
                      type="number" min="0.01" max="100000" step="0.01"
                      placeholder="0.00"
                      className="ui-input w-full"
                      style={{ paddingLeft: '1.5rem' }}
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
                  Total: {formatMoney(Math.round(lineItems.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0) * 100))}
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
    const amount = Math.round(parseFloat(f.get('amount') as string) * 100);
    // Guard against fat-fingered amounts (an extra zero turns £250 into a
    // ledger-polluting figure). The server hard-caps at £1,000,000; anything
    // over £10,000 is almost certainly a typo for a music lesson, so make the
    // user confirm it before it hits the ledger.
    if (amount > 100_000_000) {
      setError('Amount can’t exceed £1,000,000.'); setSaving(false); return;
    }
    if (amount > 1_000_000 &&
        !window.confirm(`Record a payment of £${(amount / 100).toLocaleString('en-GB', { minimumFractionDigits: 2 })}? That’s unusually large — check for an extra digit.`)) {
      setSaving(false); return;
    }
    try {
      await apiFetch('/payments', { method: 'POST', token: tok(), body: JSON.stringify({
        familyId,
        invoiceId: invoiceId || undefined,
        method,
        amount,
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
            options={families.map(f => ({ value: f.id, label: familyLabel(f) }))}
            value={familyId}
            onChange={setFamilyId}
            placeholder="Select family…"
          />
        </div>
        {invoices.length > 0 && (
          <div>
            <label className="ui-label">Apply to invoice</label>
            <SearchableSelect
              options={invoices.map(i => ({ value: i.id, label: `${i.number} — ${formatMoney(i.total)}` }))}
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
              { value: 'other',         label: 'Other' },
            ]}
            value={method}
            onChange={setMethod}
          />
        </div>
        <div>
          <label className="ui-label">Amount (£) <span style={{ color: 'var(--coral)' }}>*</span></label>
          <input name="amount" type="number" min="0.01" max="1000000" step="0.01" required className="ui-input" />
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

export default function BillingPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [showPayment, setShowPayment] = useState(false);

  // A guardian OR a logged-in student is receive-only: they see their own
  // family's invoices from the family-portal route (the admin /invoices list
  // is staff-gated) and never get the create/record controls. A student may be
  // an adult with no guardian account managing their own billing.
  const [role, setRole] = useState('');
  useEffect(() => {
    try {
      const t = document.cookie.match(/access_token=([^;]+)/)?.[1];
      setRole(t ? (JSON.parse(atob(t.split('.')[1]!)).role ?? '') : '');
    } catch { /* not signed in */ }
  }, []);
  const isFamilyPortal = role === 'guardian' || role === 'student';

  // Cached read — instant on revisit, revalidates in the background. Key stays
  // null until we know the role so we never fire the staff route for a parent.
  const { data: invoices = [], isLoading, mutate } = useApi<Invoice[]>(
    role ? (isFamilyPortal ? '/family/invoices' : '/invoices') : null,
  );
  const load = () => mutate();

  const outstanding = invoices.filter(i => i.status === 'sent').reduce((s, i) => s + i.total, 0);

  return (
    <div>
      <CreateInvoiceModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={load} />
      <RecordPaymentModal open={showPayment} onClose={() => setShowPayment(false)} onCreated={load} />
      {!isFamilyPortal && <SectionTabs items={SECTION_ITEMS} />}
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Billing
            <InfoTooltip text="'Outstanding' is the total still unpaid across all invoices. Staff see the whole studio's balance here; a guardian or student signed in sees only their own family's invoices and what they owe." />
          </span>
        }
        subtitle={outstanding > 0 ? `${formatMoney(outstanding)} outstanding` : undefined}
        action={
          isFamilyPortal ? undefined : (
            <div className="flex gap-2">
              <button onClick={() => setShowPayment(true)} className="ui-btn-ghost">
                <PoundSterling size={15} /> Record payment
              </button>
              <button onClick={() => setShowCreate(true)} className="ui-btn-primary">
                <Plus size={15} /> Create invoice
              </button>
              <AutomatedHint by="autoInvoicing" />
            </div>
          )
        }
      />

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Invoice #</th>
              {!isFamilyPortal && <th>Family</th>}
              <th>Mode</th>
              <th>Issued</th>
              <th>Due</th>
              <th style={{ textAlign: 'right' }}>Total</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 && (!role || isLoading) && (
              <tr><td colSpan={isFamilyPortal ? 6 : 7} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>
                Loading…
              </td></tr>
            )}
            {invoices.length === 0 && role && !isLoading && (
              <tr><td colSpan={isFamilyPortal ? 6 : 7} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>
                No invoices yet.
              </td></tr>
            )}
            {invoices.map(i => (
              <tr key={i.id}>
                <td>
                  <Link href={isFamilyPortal ? `/pay/${i.id}` : `/app/billing/${i.id}`}
                    className="font-semibold hover:underline"
                    style={{ color: 'var(--sage-dk)' }}>
                    {i.number}
                  </Link>
                </td>
                {!isFamilyPortal && (
                  <td>
                    {i.family
                      ? <Link href={`/app/families/${i.family.id}`} className="hover:underline" style={{ color: 'var(--txt2)' }}>{familyLabel(i.family)}</Link>
                      : '—'}
                  </td>
                )}
                <td className="text-xs capitalize" style={{ color: 'var(--txt3)' }}>{i.mode.replace(/_/g, ' ')}</td>
                <td style={{ color: 'var(--txt3)' }}>{i.issuedOn}</td>
                <td style={{ color: 'var(--txt3)' }}>{i.dueDate}</td>
                <td className="font-semibold" style={{ textAlign: 'right' }}>
                  <span className="inline-flex items-center gap-2 justify-end">
                    {/* A negative total is a credit note, not money owed —
                        showing "£-4.00" alongside an "awaiting payment" dot
                        read as a debt nobody could ever collect. */}
                    {i.total < 0
                      ? <span title="Credit note — money owed to the family, not by them">{formatMoney(Math.abs(i.total))} credit</span>
                      : formatMoney(i.total)}
                    {i.total > 0 && i.status !== 'void' && i.status !== 'draft' && (
                      <PaidDot paid={i.status === 'paid'} title={i.status === 'paid' ? 'Paid' : 'Awaiting payment'} />
                    )}
                  </span>
                </td>
                <td><Badge variant={invoiceStatusColor(i)}>{invoiceStatusLabel(i)}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
