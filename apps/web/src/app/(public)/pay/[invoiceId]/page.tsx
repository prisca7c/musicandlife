'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';

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
          {data && (
            <>
              <h1 className="text-xl font-bold text-gray-900 mb-1">Pay Invoice {data.number}</h1>
              <p className="text-sm text-gray-500 mb-6">{data.org.name}</p>

              <div className="rounded-lg bg-gray-50 border p-4 mb-6">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total due</p>
                <p className="text-2xl font-bold text-gray-900">£{(data.total / 100).toFixed(2)}</p>
                <p className="text-xs text-gray-500 mt-1">Due {data.dueDate}</p>
                {data.status === 'paid' && <p className="text-xs font-semibold text-green-700 mt-2">This invoice has already been paid.</p>}
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
