'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { AutomatedHint } from '@/components/automated-hint';
import { LoadState } from '@/components/load-state';
import { PageHeader } from '@/components/page-header';
import { InfoTooltip } from '@/components/info-tooltip';
import { Badge } from '@/components/badge';
import { fmtDate } from '@/lib/datetime';
import { UserPlus, Search } from 'lucide-react';
import { AddStudentModal } from '@/components/add-student-modal';
import { useRole } from '@/lib/use-role';
import IntakePage from '@/app/app/intake/page';

interface Student {
  id: string; firstName: string; lastName: string; status: string;
  family: { id: string; name: string; contactName: string | null; email: string | null; phone: string | null; address: string | null } | null;
  enrollments?: { instrument: string; status: string; teacher: { id: string; firstName: string; lastName: string } | null }[];
  nextLessonAt: string | null;
  creditsAvailable: number;
}

// Instruments/teachers are stored with inconsistent casing ("Piano" vs "piano"),
// so we title-case for display — matching how the PDFs render them — and dedupe
// case-insensitively so the same instrument/teacher can't show twice.
function titleCase(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}
function activeEnrollments(s: Student) {
  return (s.enrollments ?? []).filter(e => e.status !== 'withdrawn');
}
function instrumentsOf(s: Student): string {
  const byKey = new Map<string, string>();
  for (const e of activeEnrollments(s)) {
    if (!e.instrument) continue;
    const key = e.instrument.trim().toLowerCase();
    if (key && !byKey.has(key)) byKey.set(key, titleCase(e.instrument.trim()));
  }
  return [...byKey.values()].join(', ') || '—';
}
function teachersOf(s: Student): string {
  const byId = new Map<string, string>();
  for (const e of activeEnrollments(s)) {
    if (e.teacher) byId.set(e.teacher.id, `${e.teacher.firstName} ${e.teacher.lastName}`);
  }
  return [...byId.values()].join(', ') || '—';
}

type SortKey = 'name' | 'family' | 'nextLesson' | 'credits';
const SORTERS: Record<SortKey, (a: Student, b: Student) => number> = {
  // The API already returns the page ordered by first name — this is the
  // default, so no re-sort needed for it.
  name: () => 0,
  family: (a, b) => (a.family?.contactName || a.family?.name || '').localeCompare(b.family?.contactName || b.family?.name || ''),
  nextLesson: (a, b) => (a.nextLessonAt ?? '9999').localeCompare(b.nextLessonAt ?? '9999'),
  credits: (a, b) => b.creditsAvailable - a.creditsAvailable,
};

const PAGE_SIZE = 50;

// The roster itself — split out so the default export below can put it behind
// a "Students" tab alongside "New students" (sign-ups/enquiries/import, moved
// here from its own sidebar entry so both live under one "Students" section).
function StudentRoster() {
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<SortKey>('name');
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
  const fetched = data?.data ?? [];
  const students = sort === 'name' ? fetched : [...fetched].sort(SORTERS[sort]);
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
          <span className="inline-flex items-center gap-2">Students</span>
        }
        subtitle={`${total} student${total !== 1 ? 's' : ''}`}
        action={
          // Kept, but marked optional — students normally arrive via Sign-ups.
          <span className="inline-flex items-center gap-1.5">
            <button onClick={() => setShowAdd(true)} className="ui-btn-primary">
              <UserPlus size={15} /> Add student
            </button>
            <AutomatedHint by="signups" />
          </span>
        }
      />

      <div className="mb-5 flex items-center gap-2">
        <div className="relative flex-1">
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
        <select value={sort} onChange={e => setSort(e.target.value as SortKey)} className="ui-input w-auto shrink-0">
          <option value="name">Sort: Name (A–Z)</option>
          <option value="family">Sort: Family</option>
          <option value="nextLesson">Sort: Next lesson</option>
          <option value="credits">Sort: Most credits</option>
        </select>
      </div>

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Family</th>
              <th>Instruments</th>
              <th>Teachers</th>
              <th>Next lesson</th>
              <th>Credits</th>
            </tr>
          </thead>
          <tbody>
            {students.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>
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
                  {/* Status lives on the detail page now — this list is a quick
                      scan across many students, not a place to manage state. A
                      trial student is still flagged inline since promoting one
                      is a common, one-click action worth keeping visible. */}
                  <span className="inline-flex items-center gap-2">
                    <Link href={`/app/students/${s.id}`}
                      className="font-semibold hover:underline"
                      style={{ color: 'var(--sage-dk)' }}>
                      {s.firstName} {s.lastName}
                    </Link>
                    {s.status === 'trial' && (
                      <button
                        onClick={() => convertToActive(s.id)}
                        disabled={converting === s.id}
                        className="text-xs font-medium px-2 py-0.5 rounded-md border hover:bg-[var(--sage-lt)] disabled:opacity-60"
                        style={{ borderColor: 'var(--sage-md)', color: 'var(--sage-dk)' }}
                        title="Promote this trial student to a full active student"
                      >
                        {converting === s.id ? 'Converting…' : 'Trial'}
                      </button>
                    )}
                    {s.status !== 'trial' && s.status !== 'active' && (
                      <Badge variant={s.status}>{s.status}</Badge>
                    )}
                  </span>
                </td>
                <td style={{ color: 'var(--txt3)' }}>
                  {s.family ? (
                    <div>
                      <Link href={`/app/families/${s.family.id}`} className="hover:underline font-medium" style={{ color: 'var(--txt2)' }}>
                        {s.family.contactName || s.family.name}
                      </Link>
                      {(s.family.email || s.family.phone || s.family.address) && (
                        <div className="text-[11px] leading-tight mt-0.5" style={{ color: 'var(--txt4)' }}>
                          {s.family.email && <div className="truncate max-w-[180px]">{s.family.email}</div>}
                          {s.family.phone && <div>{s.family.phone}</div>}
                          {s.family.address && <div className="truncate max-w-[180px]">{s.family.address}</div>}
                        </div>
                      )}
                    </div>
                  ) : '—'}
                </td>
                <td style={{ color: 'var(--txt3)' }}>{instrumentsOf(s)}</td>
                <td style={{ color: 'var(--txt3)' }}>{teachersOf(s)}</td>
                <td style={{ color: 'var(--txt3)' }}>
                  {s.nextLessonAt ? fmtDate(s.nextLessonAt, { day: 'numeric', month: 'short' }) : '—'}
                </td>
                <td className="font-medium" style={{ color: s.creditsAvailable > 0 ? 'var(--sage-dk)' : 'var(--txt3)' }}>
                  {s.creditsAvailable}
                </td>
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

// New students (sign-ups/enquiries/import) is admin-only, matching /app/intake's
// own access rule — a teacher just gets the roster with no tab bar at all.
export default function StudentsPage() {
  const role = useRole();
  const [tab, setTab] = useState<'roster' | 'new'>('roster');

  if (role !== 'admin') return <StudentRoster />;

  return (
    <div>
      <div className="flex gap-1 mb-5 border-b" style={{ borderColor: 'var(--bd)' }}>
        {(['roster', 'new'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors"
            style={{
              borderColor: tab === t ? 'var(--sage)' : 'transparent',
              color: tab === t ? 'var(--sage)' : 'var(--txt3)',
            }}>
            {t === 'roster' ? 'Students' : 'New students'}
          </button>
        ))}
      </div>
      {tab === 'roster' ? <StudentRoster /> : <IntakePage />}
    </div>
  );
}
