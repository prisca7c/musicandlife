'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { apiFetch } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import type { InvoicePDFData, OrgPDFData } from '@/components/invoice-pdf';

// Load the PDF download button client-side only (react-pdf uses browser APIs) —
// same lazy pattern as the admin invoice page.
const PdfDownloadButton = dynamic(
  () => import('@/components/pdf-download-button').then(m => m.PdfDownloadButton),
  { ssr: false, loading: () => <button className="text-sm underline text-gray-600" disabled>Download PDF…</button> }
);

interface PublicLineItem {
  id: string; description: string; amount: number;
  date: string | null; teacher: string | null; student: string | null; instrument: string | null;
}

interface PublicInvoiceSummary {
  number: string;
  total: number;
  status: string;
  dueDate: string;
  issuedOn: string;
  notes: string | null;
  lineItems: PublicLineItem[];
  family: { name: string; address: string | null } | null;
  org: {
    name: string;
    address?: string;
    bankSortCode?: string;
    bankAccountNumber?: string;
    bankAccountName?: string;
    invoiceNotes?: string;
  };
}

async function toBase64(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise(resolve => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result as string);
    r.readAsDataURL(blob);
  });
}

export default function PayInvoicePage() {
  const params = useParams<{ invoiceId: string }>();
  const [data, setData] = useState<PublicInvoiceSummary | null>(null);
  const [error, setError] = useState('');
  const [logoSrc, setLogoSrc] = useState('');

  useEffect(() => {
    apiFetch<PublicInvoiceSummary>(`/public/invoices/${params.invoiceId}`)
      .then(setData)
      .catch(err => setError(err instanceof Error ? err.message : 'Could not load invoice'));
  }, [params.invoiceId]);

  // Local static asset, not an API call — same as the admin invoice page.
  useEffect(() => { toBase64('/logo-full.png').then(setLogoSrc).catch(() => {}); }, []);

  const pdfInvoice: InvoicePDFData | null = data ? {
    number: data.number,
    status: data.status,
    total: data.total,
    issuedOn: data.issuedOn,
    dueDate: data.dueDate,
    notes: data.notes,
    payUrl: typeof window !== 'undefined' ? window.location.href : undefined,
    family: data.family ? { name: data.family.name, email: null, address: data.family.address } : null,
    lineItems: data.lineItems.map(li => ({
      id: li.id,
      description: li.student ? `${li.student} — ${li.description}` : li.description,
      amount: li.amount,
      date: li.date ?? undefined,
      teacher: li.teacher ?? undefined,
      instrument: li.instrument ?? undefined,
    })),
  } : null;
  const pdfOrg: OrgPDFData | null = data ? {
    name: data.org.name,
    address: data.org.address,
    bankSortCode: data.org.bankSortCode,
    bankAccountNumber: data.org.bankAccountNumber,
    bankAccountName: data.org.bankAccountName,
    invoiceNotes: data.org.invoiceNotes,
  } : null;

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-md mx-auto">
        <div className="bg-white rounded-xl border shadow-sm p-8">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!data && !error && <p className="text-sm text-gray-400">Loading…</p>}
          {data && data.total <= 0 ? (
            // A zero/negative total is a credit note, not a bill. Never show a
            // "Pay … Total due -£4.00" screen — there is nothing to pay.
            <>
              <h1 className="text-xl font-bold text-gray-900 mb-1">Invoice {data.number}</h1>
              <p className="text-sm text-gray-500 mb-6">{data.org.name}</p>
              <div className="rounded-lg bg-green-50 border border-green-200 p-4">
                <p className="text-xs text-green-700 uppercase tracking-wide mb-1">Nothing to pay</p>
                <p className="text-sm text-gray-700">
                  {data.total < 0
                    ? <>This is a credit of <span className="font-semibold">{formatMoney(-data.total)}</span> in your favour — it will be set against future lessons. There is nothing to pay.</>
                    : <>There is nothing to pay on this invoice.</>}
                </p>
              </div>
            </>
          ) : data && data.status === 'paid' ? (
            // Already settled. Pay links live in emails and bookmarks forever, so
            // a payer can easily re-open a paid invoice — never re-present the
            // "Pay Invoice" call-to-action and bank details, or they may pay twice.
            <>
              <h1 className="text-xl font-bold text-gray-900 mb-1">Invoice {data.number}</h1>
              <p className="text-sm text-gray-500 mb-6">{data.org.name}</p>
              <div className="rounded-lg bg-green-50 border border-green-200 p-4">
                <p className="text-xs text-green-700 uppercase tracking-wide mb-1">Paid</p>
                <p className="text-sm text-gray-700">
                  This invoice for <span className="font-semibold">{formatMoney(data.total)}</span> has been paid in full. There is nothing more to do.
                </p>
              </div>
            </>
          ) : data && (
            <>
              <h1 className="text-xl font-bold text-gray-900 mb-1">Pay Invoice {data.number}</h1>
              <p className="text-sm text-gray-500 mb-6">{data.org.name}</p>

              <div className="rounded-lg bg-gray-50 border p-4 mb-6">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total due</p>
                <p className="text-2xl font-bold text-gray-900">{formatMoney(data.total)}</p>
                <p className="text-xs text-gray-500 mt-1">Due {data.dueDate}</p>
              </div>

              {(data.org.bankAccountNumber || data.org.bankSortCode) && (
                <div className="space-y-2 text-sm text-gray-700 mb-4">
                  <p className="font-semibold text-gray-900">Pay by bank transfer</p>
                  {data.org.bankAccountName && <p>Account name: {data.org.bankAccountName}</p>}
                  {data.org.bankSortCode && <p>Sort code: {data.org.bankSortCode}</p>}
                  {data.org.bankAccountNumber && <p>Account number: {data.org.bankAccountNumber}</p>}
                  <p>Payment reference: <span className="font-semibold">{data.number}</span></p>
                </div>
              )}

              {data.org.invoiceNotes && (
                <p className="text-xs text-gray-500 whitespace-pre-line mb-4">{data.org.invoiceNotes}</p>
              )}

              {/* Never strand a payer on a "Pay" page with no way to pay. If the
                  studio hasn't configured bank details and there are no
                  free-text payment notes, at least tell them to get in touch —
                  with the reference so the studio can match it. */}
              {data.status !== 'paid' &&
                !data.org.bankAccountNumber &&
                !data.org.bankSortCode &&
                !data.org.invoiceNotes && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-gray-700 mb-4">
                    <p className="font-semibold text-gray-900 mb-1">How to pay</p>
                    <p>
                      Please contact {data.org.name} to arrange payment, quoting reference{' '}
                      <span className="font-semibold">{data.number}</span>.
                    </p>
                  </div>
                )}
            </>
          )}

          {/* What's actually being charged for — the same breakdown the admin
              invoice page shows, previously missing here entirely. */}
          {data && data.lineItems.length > 0 && (
            <div className="mt-6 pt-6 border-t">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">What this covers</p>
              <div className="space-y-2">
                {data.lineItems.map(li => (
                  <div key={li.id} className="flex justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="text-gray-900 truncate">
                        {li.student ? `${li.student} — ` : ''}{li.description}
                      </p>
                      <p className="text-xs text-gray-500">
                        {[li.date, li.instrument, li.teacher].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <span className="font-medium text-gray-900 shrink-0">{formatMoney(li.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pdfInvoice && (
            <div className="mt-6 pt-4 border-t flex justify-end">
              <PdfDownloadButton invoice={pdfInvoice} org={pdfOrg} logoSrc={logoSrc} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
