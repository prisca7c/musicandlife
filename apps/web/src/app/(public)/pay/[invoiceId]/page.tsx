'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { formatMoney } from '@/lib/money';

interface PublicInvoiceSummary {
  number: string;
  total: number;
  status: string;
  dueDate: string;
  org: {
    name: string;
    bankSortCode?: string;
    bankAccountNumber?: string;
    bankAccountName?: string;
    invoiceNotes?: string;
  };
}

export default function PayInvoicePage() {
  const params = useParams<{ invoiceId: string }>();
  const [data, setData] = useState<PublicInvoiceSummary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<PublicInvoiceSummary>(`/public/invoices/${params.invoiceId}`)
      .then(setData)
      .catch(err => setError(err instanceof Error ? err.message : 'Could not load invoice'));
  }, [params.invoiceId]);

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
                <p className="text-xs text-gray-500 whitespace-pre-line">{data.org.invoiceNotes}</p>
              )}

              {/* Never strand a payer on a "Pay" page with no way to pay. If the
                  studio hasn't configured bank details (and there's no card option
                  yet) and there are no free-text payment notes, at least tell them
                  to get in touch — with the reference so the studio can match it. */}
              {data.status !== 'paid' &&
                !data.org.bankAccountNumber &&
                !data.org.bankSortCode &&
                !data.org.invoiceNotes && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-gray-700">
                    <p className="font-semibold text-gray-900 mb-1">How to pay</p>
                    <p>
                      Please contact {data.org.name} to arrange payment, quoting reference{' '}
                      <span className="font-semibold">{data.number}</span>.
                    </p>
                  </div>
                )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
