'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { LoadState } from '@/components/load-state';
import { PageHeader } from '@/components/page-header';
import { InfoTooltip } from '@/components/info-tooltip';
import { Badge } from '@/components/badge';
import { UserPlus, Search } from 'lucide-react';
import { AddStudentModal } from '@/components/add-student-modal';

interface Student { id: string; firstName: string; lastName: string; status: string; family: { id: string; name: string } | null; enrollments?: { instrument: string; status: string }[]; }

// Distinct instruments across a student's non-withdrawn enrollments.
function instrumentsOf(s: Student): string {
  const active = (s.enrollments ?? []).filter(e => e.status !== 'withdrawn' && e.instrument);
  return [...new Set(active.map(e => e.instrument))].join(', ') || '—';
}

const PAGE_SIZE = 50;

export default function StudentsPage() {
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [offset, setOffset] = useState(0);
  const [converting, setConverting] = useState<string | null>(null);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  // The API path IS the cache key: revisiting this page (or paging back to a
  // page you already loaded) renders instantly from cache, then revalidates in
  // the background. keepPreviousData keeps the current rows on screen while a
  // new search/page loads instead of flashing empty.
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (search) params.set('search', search);
  const key = `/students?${params.toString()}`;
  const { data, error, isLoading, mutate } = useApi<{ data: Student[]; total: number }>(key);
  const students = data?.data ?? [];
  const total = data?.total ?? 0;

  // Trial students never auto-promote — approval creates them as "trial" and
  // nothing flips them. This lets staff convert a trial to a full active student.
  async function convertToActive(id: string) {
    setConverting(id);
    try {
      await apiFetch(`/students/${id}`, { method: 'PATCH', token: tok(), body: JSON.stringify({ status: 'active' }) });
      // Optimistically flip the row in the cached list without a refetch.
      mutate(
        prev => prev && { ...prev, data: prev.data.map(s => s.id === id ? { ...s, status: 'active' } : s) },
        { revalidate: false },
      );
    } catch { /* leave as-is on failure */ }
    finally { setConverting(null); }
  }

  return (
    <div>
      <AddStudentModal open={showAdd} onClose={() => setShowAdd(false)} onCreated={() => mutate()} />
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Students
            <InfoTooltip text="Most students land here automatically — when a family registers online and you approve them under New students, their student record, enrollment and portal login are all created for you. 'Add student' is only for someone who signs up in person." />
          </span>
        }
        subtitle={`${total} student${total !== 1 ? 's' : ''}`}
        action={
          <button onClick={() => setShowAdd(true)} className="ui-btn-primary">
            <UserPlus size={15} /> Add student
          </button>
        }
      />

      <div className="mb-5 relative">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: 'var(--txt4)' }}>
          <Search size={15} />
        </span>
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setOffset(0); }}
          placeholder="Search by name…"
          className="ui-search pl-9"
        />
      </div>

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Family</th>
              <th>Status</th>
              <th>Instruments</th>
            </tr>
          </thead>
          <tbody>
            {students.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>
                {/* A failed load used to render as "No students yet." — an
                    empty studio, rather than a request that didn't come back. */}
                {error || isLoading
                  ? <LoadState error={error} loading={isLoading} onRetry={() => mutate()}
                      failedLabel="Couldn't load students." />
                  : search ? 'No students match that search.' : 'No students yet.'}
              </td></tr>
            )}
            {students.map(s => (
              <tr key={s.id}>
                <td>
                  <Link href={`/app/students/${s.id}`}
                    className="font-semibold hover:underline"
                    style={{ color: 'var(--sage-dk)' }}>
                    {s.firstName} {s.lastName}
                  </Link>
                </td>
                <td style={{ color: 'var(--txt3)' }}>
                  {s.family
                    ? <Link href={`/app/families/${s.family.id}`} className="hover:underline" style={{ color: 'var(--txt2)' }}>{s.family.name}</Link>
                    : '—'}
                </td>
                <td>
                  <span className="inline-flex items-center gap-2">
                    <Badge variant={s.status}>{s.status}</Badge>
                    {s.status === 'trial' && (
                      <button
                        onClick={() => convertToActive(s.id)}
                        disabled={converting === s.id}
                        className="text-xs font-medium px-2 py-0.5 rounded-md border hover:bg-[var(--sage-lt)] disabled:opacity-60"
                        style={{ borderColor: 'var(--sage-md)', color: 'var(--sage-dk)' }}
                        title="Promote this trial student to a full active student"
                      >
                        {converting === s.id ? 'Converting…' : 'Convert to active'}
                      </button>
                    )}
                  </span>
                </td>
                <td style={{ color: 'var(--txt3)' }}>{instrumentsOf(s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between mt-4 text-sm" style={{ color: 'var(--txt3)' }}>
          <span>
            Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button
              className="ui-btn-ghost"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              ← Prev
            </button>
            <button
              className="ui-btn-ghost"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
