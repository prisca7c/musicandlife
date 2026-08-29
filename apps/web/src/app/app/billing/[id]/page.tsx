'use client';

import { useState, useEffect, FormEvent } from 'react';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { useApi } from '@/lib/swr';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/badge';
import { Modal } from '@/components/modal';
import { BackButton } from '@/components/back-button';
import { Calendar, Pencil, Trash2 } from 'lucide-react';
import type { InvoicePDFData, OrgPDFData } from '@/components/invoice-pdf';
import { invoiceStatusLabel, invoiceStatusColor } from '@/lib/invoice-status';

// Load the PDF download button client-side only (react-pdf uses browser APIs)
const PdfDownloadButton = dynamic(
  () => import('@/components/pdf-download-button').then(m => m.PdfDownloadButton),
  { ssr: false, loading: () => <button className="ui-btn-ghost text-sm" disabled>↓ Download PDF</button> }
);

interface InvoiceDetail {
  id: string; number: string; status: string; total: number; issuedOn: string; dueDate: string;
  mode: string; notes: string | null; balanceForward: number;
  family: { id: string; name: string; contactName: string | null; email: string | null } | null;
  lineItems: {
    id: string; description: string; amount: number; lessonId: string | null;
    date: string | null; startsAt: string | null; duration: number | null;
    teacher: string | null; student: string | null; instrument: string | null; lessonType: string | null;
  }[];
}

interface OrgSettings {
  id: string; name: string; timezone: string; currency: string;
  settings: {
    address?: string; contactEmail?: string; contactPhone?: string;
    bankSortCode?: string; bankAccountNumber?: string; bankAccountName?: string;
    invoiceDueDays?: number; invoiceNotes?: string;
  };
}

interface FamilyDetail { address: string | null; }

async function toBase64(url: string): Promise<string> {
  const res  = await fetch(url);
  const blob = await res.blob();
  return new Promise(resolve => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result as string);
    r.readAsDataURL(blob);
  });
}

// Doubles as the edit modal — pass `editing` to PATCH an existing manual item
// instead of POSTing a new one, pre-filled with its current values.
function AddLineItemModal({ open, onClose, invoiceId, onAdded, editing }: {
  open: boolean; onClose: () => void; invoiceId: string; onAdded: () => void;
  editing?: { id: string; description: string; amount: number } | null;
}) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    const body = JSON.stringify({
      description: f.get('description'), amount: Math.round(parseFloat(f.get('amount') as string) * 100),
    });
    try {
      if (editing) {
        await apiFetch(`/invoices/${invoiceId}/line-items/${editing.id}`, { method: 'PATCH', token: tok(), body });
      } else {
        await apiFetch(`/invoices/${invoiceId}/line-items`, { method: 'POST', token: tok(), body });
      }
      onAdded(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit line item' : 'Add line item'}>
      {error && (
        <div className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4" key={editing?.id ?? 'new'}>
        <div>
          <label className="ui-label">Description <span style={{ color: 'var(--coral)' }}>*</span></label>
          <input name="description" required className="ui-input" defaultValue={editing?.description} />
        </div>
        <div>
          <label className="ui-label">Amount (£) <span style={{ color: 'var(--coral)' }}>*</span></label>
          <input name="amount" type="number" step="0.01" required className="ui-input"
            defaultValue={editing ? (editing.amount / 100).toFixed(2) : undefined}
            placeholder="Use negative values for discounts, e.g. -5.00" />
        </div>
        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving} className="ui-btn-primary">
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add item'}
          </button>
          <button type="button" onClick={onClose} className="ui-btn-ghost">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

export default function InvoiceDetailPage() {
  const params                                 = useParams<{ id: string }>();
  const [logoSrc, setLogoSrc]                  = useState('');
  const [showAddItem, setShowAddItem]          = useState(false);
  const [editingItem, setEditingItem]          = useState<{ id: string; description: string; amount: number } | null>(null);
  const [deletingId, setDeletingId]            = useState<string | null>(null);
  const [actioning, setActioning]              = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  // Cached reads — instant on revisit. mutate() refreshes after an action.
  const { data: invoice = null, mutate } = useApi<InvoiceDetail>(`/invoices/${params.id}`);
  const load = () => mutate();
  // Family address is only needed once the invoice resolves (dependent read).
  const { data: familyDetail } = useApi<FamilyDetail>(invoice?.family?.id ? `/families/${invoice.family.id}` : null);
  const familyAddress = familyDetail?.address ?? null;
  // Org settings for the PDF, reshaped to the template's expected fields.
  const { data: orgSettings } = useApi<OrgSettings>('/organizations/me');
  const org: OrgPDFData | null = orgSettings ? {
    name:               orgSettings.name,
    address:            orgSettings.settings.address,
    bankSortCode:       orgSettings.settings.bankSortCode,
    bankAccountNumber:  orgSettings.settings.bankAccountNumber,
    bankAccountName:    orgSettings.settings.bankAccountName,
    invoiceNotes:       orgSettings.settings.invoiceNotes,
  } : null;

  // Pre-fetch the logo as base64 for PDF embedding (local asset, not an API call).
  useEffect(() => { toBase64('/logo-full.png').then(setLogoSrc).catch(() => {}); }, []);

  async function action(path: string) {
    setActioning(true);
    try { await apiFetch(`/invoices/${params.id}/${path}`, { method: 'POST', token: tok() }); load(); }
    catch (e) { console.error(e); }
    finally { setActioning(false); }
  }

  async function deleteLineItem(id: string, description: string) {
    if (!confirm(`Remove "${description}" from this invoice? This updates the total immediately.`)) return;
    setDeletingId(id);
    try { await apiFetch(`/invoices/${params.id}/line-items/${id}`, { method: 'DELETE', token: tok() }); load(); }
    catch (e) { console.error(e); }
    finally { setDeletingId(null); }
  }

  if (!invoice) return <div className="p-8 text-center text-sm" style={{ color: 'var(--txt4)' }}>Loading…</div>;

  // Matches the backend guard: only paid/void invoices are frozen. A sent
  // invoice can still have its manual items corrected (e.g. before payment
  // clears), same as it could already gain new ones.
  const editable = invoice.status === 'draft' || invoice.status === 'sent';

  // Build the data shape expected by the PDF template
  const pdfInvoice: InvoicePDFData = {
    id:              invoice.id,
    number:          invoice.number,
    status:          invoice.status,
    total:           invoice.total,
    balanceForward:  invoice.balanceForward,
    issuedOn:        invoice.issuedOn,
    dueDate:         invoice.dueDate,
    notes:           invoice.notes,
    payUrl:          typeof window !== 'undefined' ? `${window.location.origin}/pay/${invoice.id}` : undefined,
    family:    invoice.family
      ? { name: invoice.family.contactName?.trim() || invoice.family.name, email: invoice.family.email, address: familyAddress }
      : null,
    lineItems: invoice.lineItems.map(li => ({
      id:          li.id,
      description: li.description,
      amount:      li.amount,
      date:        li.date ?? undefined,
      teacher:     li.teacher ?? undefined,
      instrument:  li.instrument ?? undefined,
      lessonId:    li.lessonId,
    })),
  };

  return (
    <div className="max-w-3xl">
      <AddLineItemModal open={showAddItem} onClose={() => setShowAddItem(false)} invoiceId={invoice.id} onAdded={load} />
      <AddLineItemModal
        open={!!editingItem}
        onClose={() => setEditingItem(null)}
        invoiceId={invoice.id}
        onAdded={load}
        editing={editingItem}
      />

      <div className="mb-5">
        <BackButton label="Billing" fallbackHref="/app/billing" />
      </div>

      {/* Invoice letterhead */}
      <div className="bg-white rounded-2xl border px-6 py-5 mb-5 flex items-center justify-between"
        style={{ borderColor: 'var(--bd)' }}>
        <Image src="/logo-full.png" alt="Music & Life London"
          width={220} height={95}
          className="h-14 w-auto object-contain" />
        <div className="text-right text-sm" style={{ color: 'var(--txt3)' }}>
          <p className="font-bold text-base" style={{ color: 'var(--txt)' }}>Invoice {invoice.number}</p>
          <p className="mt-1"><Badge variant={invoiceStatusColor(invoice)}>{invoiceStatusLabel(invoice)}</Badge></p>
        </div>
      </div>

      <PageHeader
        title={`Invoice ${invoice.number}`}
        subtitle={invoice.family?.contactName?.trim() || invoice.family?.name}
        action={
          <div className="flex items-center gap-2">
            <PdfDownloadButton invoice={pdfInvoice} org={org} logoSrc={logoSrc} />
            {invoice.status === 'draft' && (
              <button onClick={() => action('send')} disabled={actioning} className="ui-btn-primary text-sm">
                Send
              </button>
            )}
            {invoice.status !== 'void' && invoice.status !== 'paid' && (
              <button
                onClick={() => {
                  // Voiding isn't just a label change: it reverses the charge on
                  // the family's balance immediately, and there's no "unvoid" —
                  // the only way back is raising a new invoice. One click on a
                  // page full of harmless buttons (Send, Download) was too easy
                  // to hit by mistake.
                  if (!confirm(`Void invoice ${invoice.number}? This removes ${formatMoney(invoice.total)} from ${invoice.family?.contactName?.trim() || invoice.family?.name || 'the family'}'s balance immediately and can't be undone — to bill them again you'll need to raise a new invoice.`)) return;
                  action('void');
                }}
                disabled={actioning}
                className="text-sm rounded-[10px] px-4 py-2 font-semibold transition-colors disabled:opacity-50"
                style={{ border: '1.5px solid #FCA5A5', color: 'var(--coral)', background: '#fff' }}>
                Void
              </button>
            )}
          </div>
        }
      />

      {/* Invoice metadata */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-2xl border p-5 text-sm space-y-3" style={{ borderColor: 'var(--bd)' }}>
          <div className="flex justify-between gap-3">
            <span style={{ color: 'var(--txt3)' }}>Issued</span>
            <span className="font-medium">{invoice.issuedOn}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span style={{ color: 'var(--txt3)' }}>Due</span>
            <span className="font-medium">{invoice.dueDate}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span style={{ color: 'var(--txt3)' }}>Mode</span>
            <span className="font-medium capitalize">{invoice.mode.replace('_', ' ')}</span>
          </div>
          {invoice.family?.email && (
            <div className="flex justify-between gap-3">
              <span style={{ color: 'var(--txt3)' }}>To</span>
              <span className="font-medium text-right">{invoice.family.email}</span>
            </div>
          )}
        </div>
        <div className="bg-white rounded-2xl border p-5 flex flex-col items-center justify-center"
          style={{ borderColor: 'var(--bd)', background: 'linear-gradient(135deg, var(--sage-lt), white)' }}>
          <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--txt3)' }}>Total</p>
          <p className="font-extrabold tracking-tight"
            style={{ fontSize: '2.5rem', color: 'var(--sage-dk)', letterSpacing: '-0.03em' }}>
            {formatMoney(invoice.total)}
          </p>
        </div>
      </div>

      {/* Line items table */}
      <div className="data-table-wrap">
        <div className="px-5 py-3.5 border-b flex items-center justify-between"
          style={{ borderColor: 'var(--bd)', background: 'var(--surf)' }}>
          <h2 className="font-bold text-sm" style={{ color: 'var(--txt)' }}>Line items</h2>
          {editable && (
            <button onClick={() => setShowAddItem(true)} className="ui-btn-primary text-xs px-3 py-1.5">
              + Add item
            </button>
          )}
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Time</th>
              <th>Student</th>
              <th>Instruments/Classes</th>
              <th>Teacher</th>
              <th></th>
              <th>Description</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              {editable && <th></th>}
            </tr>
          </thead>
          <tbody>
            {!!invoice.balanceForward && (
              <tr>
                <td colSpan={7} style={{ color: 'var(--txt3)' }}>Balance forward</td>
                <td className="font-semibold" style={{ textAlign: 'right', color: 'var(--txt3)' }}>
                  {formatMoney(invoice.balanceForward)}
                </td>
                {editable && <td></td>}
              </tr>
            )}
            {invoice.lineItems.length === 0 && (
              <tr><td colSpan={editable ? 9 : 8} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>
                No line items yet.
              </td></tr>
            )}
            {invoice.lineItems.map(item => (
              <tr key={item.id}>
                <td style={{ color: 'var(--txt3)' }}>{item.date ?? '—'}</td>
                <td style={{ color: 'var(--txt3)' }}>
                  {item.startsAt
                    ? new Date(item.startsAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                    : '—'}
                </td>
                <td style={{ color: 'var(--txt3)' }}>{item.student ?? '—'}</td>
                <td className="capitalize" style={{ color: 'var(--txt3)' }}>
                  {item.instrument ?? '—'}{item.lessonType === 'group' ? ' (group)' : ''}
                </td>
                <td style={{ color: 'var(--txt3)' }}>{item.teacher ?? '—'}</td>
                <td title={item.lessonId ? 'Generated from calendar lesson' : 'Added manually'} style={{ color: 'var(--txt4)' }}>
                  {item.lessonId ? <Calendar size={12} /> : <Pencil size={12} />}
                </td>
                <td>{item.description}</td>
                <td className="font-semibold" style={{ textAlign: 'right' }}>
                  {formatMoney(item.amount)}
                </td>
                {editable && (
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {/* Only manual items (no lessonId) can be hand-edited — a
                        lesson-generated line is documentation of a calendar
                        charge, not something to override here. */}
                    {!item.lessonId && (
                      <span className="inline-flex items-center gap-2">
                        <button onClick={() => setEditingItem({ id: item.id, description: item.description, amount: item.amount })}
                          title="Edit" className="hover:opacity-70" style={{ color: 'var(--txt3)' }}>
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => deleteLineItem(item.id, item.description)}
                          disabled={deletingId === item.id}
                          title="Remove" className="hover:opacity-70 disabled:opacity-40" style={{ color: 'var(--coral)' }}>
                          <Trash2 size={13} />
                        </button>
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {invoice.lineItems.length > 0 && (
              <tr style={{ background: 'var(--surf)', fontWeight: 700 }}>
                <td colSpan={7}>Total</td>
                <td style={{ textAlign: 'right' }}>{formatMoney(invoice.total)}</td>
                {editable && <td></td>}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {invoice.notes && (
        <p className="mt-4 text-sm italic" style={{ color: 'var(--txt3)' }}>{invoice.notes}</p>
      )}
    </div>
  );
}
