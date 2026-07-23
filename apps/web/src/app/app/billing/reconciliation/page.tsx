'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { PageHeader } from '@/components/page-header';
import { AutomatedHint } from '@/components/automated-hint';
import { Badge } from '@/components/badge';
import { SearchableSelect } from '@/components/searchable-select';
import { Upload, AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface Claim {
  id: string; amount: number; reference: string; status: string; createdAt: string;
  family: { id: string; name: string; paymentReference: string | null } | null;
  invoice: { id: string; number: string; total: number; status: string } | null;
}
interface BankTxn {
  id: string; bookedOn: string; amount: number;
  reference: string | null; description: string | null; status: string;
}
interface FamilyOption { id: string; name: string }

interface ImportSummary {
  imported: number; duplicates: number;
  matchedToClaim: number; matchedToInvoice: number; creditedOnAccount: number; unmatched: number;
  skippedNonCreditRows: number;
}

const money = (pence: number) => `£${(pence / 100).toFixed(2)}`;
const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

export default function ReconciliationPage() {
  const { data: claims = [], mutate: mutateClaims } = useApi<Claim[]>('/reconciliation/claims?status=pending');
  const { data: unmatched = [], mutate: mutateUnmatched } = useApi<BankTxn[]>('/reconciliation/unmatched');
  const { data: families = [] } = useApi<FamilyOption[]>('/families');
  // Without receiving details, families are told to transfer money and never
  // told where. Surfaced here because this is the page where someone notices
  // payments aren't arriving.
  const { data: org } = useApi<{ settings?: Record<string, string> }>('/organizations/me');
  const bankSet = !!(org?.settings?.bankSortCode && org?.settings?.bankAccountNumber);

  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
    setImporting(true); setError(''); setSummary(null);
    try {
      const csv = await file.text();
      const res = await apiFetch<ImportSummary>('/reconciliation/import', {
        method: 'POST', token: tok(), body: JSON.stringify({ csv }),
      });
      setSummary(res);
      mutateClaims(); mutateUnmatched();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function act(path: string, body?: unknown) {
    setError('');
    try {
      await apiFetch(path, { method: 'POST', token: tok(), body: body ? JSON.stringify(body) : undefined });
      mutateClaims(); mutateUnmatched();
    } catch (e) { setError(e instanceof Error ? e.message : 'That did not work'); }
  }

  return (
    <div className="p-6 max-w-6xl">
      <PageHeader
        title="Payments &amp; reconciliation"
        subtitle="Import your bank statement — matched payments post themselves"
      />

      {org && !bankSet && (
        <div className="rounded-2xl border px-4 py-3 mb-6 flex items-start gap-2.5"
          style={{ borderColor: 'var(--amber-md)', background: 'var(--amber-lt)' }}>
          <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--amber)' }} />
          <div className="text-sm">
            <p className="font-bold" style={{ color: 'var(--amber)' }}>No bank details set</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--txt3)' }}>
              Families are asked to pay by transfer, but the portal and your invoices can&apos;t tell
              them which account to send it to. Add them in{' '}
              <Link href="/app/settings" className="underline font-semibold">Settings → Invoice defaults</Link>.
            </p>
          </div>
        </div>
      )}

      {/* ── Import ─────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border p-4 mb-6" style={{ borderColor: 'var(--bd)' }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-bold">Import a bank statement</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--txt3)' }}>
              CSV export from your bank. Only money coming in is imported, and re-importing an
              overlapping statement is safe — lines already seen are skipped.
            </p>
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="rounded-xl bg-[var(--green)] text-white text-sm font-semibold py-2 px-4 hover:opacity-90 transition disabled:opacity-60 inline-flex items-center gap-2"
          >
            <Upload size={15} />
            {importing ? 'Importing…' : 'Choose CSV'}
          </button>
          <input
            ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
          />
        </div>

        {error && (
          <p className="mt-3 text-xs text-[var(--coral)] flex items-center gap-1.5">
            <AlertCircle size={14} /> {error}
          </p>
        )}

        {summary && (
          <div className="mt-4 rounded-xl p-3 text-sm" style={{ background: 'var(--bg)' }}>
            <p className="font-semibold flex items-center gap-1.5">
              <CheckCircle2 size={15} className="text-[var(--green)]" />
              {summary.imported} new line{summary.imported === 1 ? '' : 's'} imported
            </p>
            <ul className="mt-2 space-y-0.5 text-xs" style={{ color: 'var(--txt3)' }}>
              <li>{summary.matchedToClaim} matched to a family&apos;s &ldquo;I&apos;ve sent it&rdquo;</li>
              <li>{summary.matchedToInvoice} matched straight to an unpaid invoice</li>
              <li>{summary.creditedOnAccount} credited on account (family known, no matching invoice)</li>
              <li><strong>{summary.unmatched} need you</strong> — listed below</li>
              <li>{summary.duplicates} already imported · {summary.skippedNonCreditRows} non-payment rows skipped</li>
            </ul>
          </div>
        )}
      </div>

      {/* ── Exceptions: the only list that normally needs a human ──────────── */}
      <h2 className="text-sm font-bold mb-2">
        Unidentified payments {unmatched.length > 0 && <Badge variant="pending">{unmatched.length}</Badge>}
        {' '}<AutomatedHint by="bankMatching" />
      </h2>
      <p className="text-xs mb-3" style={{ color: 'var(--txt3)' }}>
        Money arrived but no family reference was quoted. Assign it to a family and it posts to
        their balance.
      </p>
      <div className="rounded-2xl border mb-8" style={{ borderColor: 'var(--bd)' }}>
        {unmatched.length === 0 ? (
          <p className="p-6 text-center text-sm" style={{ color: 'var(--txt3)' }}>
            Nothing to sort out — every imported payment was matched automatically.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ color: 'var(--txt3)' }}>
                <th className="text-left p-3 font-semibold">Date</th>
                <th className="text-left p-3 font-semibold">Reference / description</th>
                <th className="text-right p-3 font-semibold">Amount</th>
                <th className="text-right p-3 font-semibold">Assign to</th>
              </tr>
            </thead>
            <tbody>
              {unmatched.map((t) => (
                <tr key={t.id} className="border-t" style={{ borderColor: 'var(--bd)' }}>
                  <td className="p-3 whitespace-nowrap">{t.bookedOn}</td>
                  <td className="p-3">
                    <span className="font-medium">{t.reference || '—'}</span>
                    {t.description && (
                      <span className="block text-xs" style={{ color: 'var(--txt3)' }}>{t.description}</span>
                    )}
                  </td>
                  <td className="p-3 text-right font-semibold">{money(t.amount)}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2 justify-end">
                      <SearchableSelect
                        value=""
                        onChange={(familyId) => { if (familyId) act(`/reconciliation/unmatched/${t.id}/assign`, { familyId }); }}
                        options={families.map((f) => ({ value: f.id, label: f.name }))}
                        placeholder="Select family…"
                      />
                      <button
                        onClick={() => act(`/reconciliation/unmatched/${t.id}/ignore`)}
                        className="text-xs font-semibold px-2 py-1 rounded-lg border"
                        style={{ borderColor: 'var(--bd)', color: 'var(--txt3)' }}
                      >
                        Not a fee
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Claims still waiting for the money to show up ──────────────────── */}
      <h2 className="text-sm font-bold mb-2">
        Waiting for the transfer {claims.length > 0 && <Badge variant="scheduled">{claims.length}</Badge>}
      </h2>
      <p className="text-xs mb-3" style={{ color: 'var(--txt3)' }}>
        Families who pressed &ldquo;I&apos;ve sent the transfer&rdquo; but whose payment hasn&apos;t appeared on a
        statement yet. These settle themselves on the next import — only step in if one is stuck.
      </p>
      <div className="rounded-2xl border" style={{ borderColor: 'var(--bd)' }}>
        {claims.length === 0 ? (
          <p className="p-6 text-center text-sm" style={{ color: 'var(--txt3)' }}>
            Nothing outstanding.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ color: 'var(--txt3)' }}>
                <th className="text-left p-3 font-semibold">Family</th>
                <th className="text-left p-3 font-semibold">Reference</th>
                <th className="text-left p-3 font-semibold">Invoice</th>
                <th className="text-right p-3 font-semibold">Amount</th>
                <th className="text-right p-3 font-semibold">Said on</th>
                <th className="text-right p-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id} className="border-t" style={{ borderColor: 'var(--bd)' }}>
                  <td className="p-3">{c.family?.name ?? '—'}</td>
                  <td className="p-3 font-mono text-xs">{c.reference}</td>
                  <td className="p-3">{c.invoice?.number ?? '—'}</td>
                  <td className="p-3 text-right font-semibold">{money(c.amount)}</td>
                  <td className="p-3 text-right whitespace-nowrap" style={{ color: 'var(--txt3)' }}>
                    {new Date(c.createdAt).toLocaleDateString('en-GB')}
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => act(`/reconciliation/claims/${c.id}/confirm`)}
                      className="text-xs font-semibold px-2 py-1 rounded-lg bg-[var(--green)] text-white"
                    >
                      Confirm anyway
                    </button>
                    <button
                      onClick={() => act(`/reconciliation/claims/${c.id}/reject`, { reason: 'No matching payment found.' })}
                      className="ml-2 text-xs font-semibold px-2 py-1 rounded-lg border"
                      style={{ borderColor: 'var(--bd)', color: 'var(--coral)' }}
                    >
                      Never arrived
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
