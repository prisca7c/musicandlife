'use client';

import { useState } from 'react';
import { useApi } from '@/lib/swr';
import { formatMoney } from '@/lib/money';
import { PageHeader } from '@/components/page-header';
import { InfoTooltip } from '@/components/info-tooltip';
import { LoadState } from '@/components/load-state';
import { SubmitPayCard } from '@/components/submit-pay-card';
import { fmtDate, fmtTime } from '@/lib/datetime';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface PayItem {
  id: string; type: 'lesson' | 'late_cancellation';
  minutesElapsed: number; amount: number; startsAt: string | null;
}
interface PayRun {
  id: string; periodStart: string; periodEnd: string;
  hoursElapsed: number; hourlyRate: number; gross: number;
  status: 'approved' | 'paid'; approvedAt: string | null;
  items: PayItem[];
}

const money = formatMoney;
// "2026-07-01" → "July 2026". Runs are monthly in practice; the exact dates are
// still shown underneath so an odd period is never misread as a whole month.
const monthLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

export default function MyPayPage() {
  const { data: runs = [], error, isLoading, mutate } = useApi<PayRun[]>('/staff/payroll/me');
  const [expanded, setExpanded] = useState<string | null>(null);

  const yearTotal = runs
    .filter(r => new Date(`${r.periodStart}T00:00:00`).getFullYear() === new Date().getFullYear())
    .reduce((s, r) => s + r.gross, 0);

  return (
    <div>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            My pay
            <InfoTooltip text="Your approved pay, month by month. Each row opens to show the lessons it was calculated from, so you can check the figure yourself. Periods the office is still working on aren't shown until they're approved." />
          </span>
        }
        subtitle="Approved pay periods, most recent first"
      />

      <div className="mb-4">
        <SubmitPayCard />
      </div>

      {(error || isLoading) && (
        <div className="bg-white rounded-2xl border p-6" style={{ borderColor: 'var(--bd)' }}>
          <LoadState error={error} loading={isLoading} onRetry={() => mutate()}
            failedLabel="Couldn't load your pay history." />
        </div>
      )}

      {!error && !isLoading && runs.length === 0 && (
        <div className="bg-white rounded-2xl border px-6 py-12 text-center" style={{ borderColor: 'var(--bd)' }}>
          <p className="text-sm" style={{ color: 'var(--txt3)' }}>No approved pay periods yet.</p>
          <p className="text-xs mt-1" style={{ color: 'var(--txt4)' }}>
            Periods appear here once the office has approved them.
          </p>
        </div>
      )}

      {!error && runs.length > 0 && (
        <>
          <div className="bg-white rounded-2xl border p-5 mb-4" style={{ borderColor: 'var(--bd)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--txt3)' }}>
              Approved so far in {new Date().getFullYear()}
            </p>
            <p className="text-2xl font-black" style={{ color: 'var(--sage-dk)' }}>{money(yearTotal)}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--txt4)' }}>gross, before any deductions</p>
          </div>

          <div className="space-y-2">
            {runs.map(r => {
              const open = expanded === r.id;
              return (
                <div key={r.id} className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--bd)' }}>
                  <button onClick={() => setExpanded(open ? null : r.id)}
                    className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-[var(--surf)] transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {open ? <ChevronDown size={15} className="shrink-0" style={{ color: 'var(--txt4)' }} />
                            : <ChevronRight size={15} className="shrink-0" style={{ color: 'var(--txt4)' }} />}
                      <div className="min-w-0">
                        <p className="font-bold text-sm" style={{ color: 'var(--txt)' }}>{monthLabel(r.periodStart)}</p>
                        <p className="text-xs" style={{ color: 'var(--txt4)' }}>
                          {r.periodStart} – {r.periodEnd} · {r.hoursElapsed}h at {money(r.hourlyRate)}/h
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-black text-sm" style={{ color: 'var(--txt)' }}>{money(r.gross)}</p>
                      <p className="text-[11px] capitalize" style={{ color: 'var(--txt4)' }}>{r.status}</p>
                    </div>
                  </button>

                  {open && (
                    <div className="border-t px-5 py-4" style={{ borderColor: 'var(--bd)', background: 'var(--surf)' }}>
                      {r.items.length === 0 ? (
                        <p className="text-sm" style={{ color: 'var(--txt4)' }}>No itemised lessons recorded for this period.</p>
                      ) : (
                        <div className="space-y-1">
                          {r.items.map(i => (
                            <div key={i.id} className="flex items-center justify-between gap-3 text-sm">
                              <span style={{ color: 'var(--txt3)' }}>
                                {i.startsAt
                                  ? `${fmtDate(i.startsAt, { day: 'numeric', month: 'short' })} · ${fmtTime(i.startsAt)}`
                                  : 'Lesson'}
                                {' · '}{i.minutesElapsed} min
                                {i.type === 'late_cancellation' && (
                                  <span className="ml-1.5 text-xs font-medium" style={{ color: 'var(--amber)' }}>
                                    late cancellation
                                  </span>
                                )}
                              </span>
                              <span className="font-semibold tabular-nums" style={{ color: 'var(--txt)' }}>{money(i.amount)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
