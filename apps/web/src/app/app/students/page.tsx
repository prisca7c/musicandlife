'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { AutomatedHint } from '@/components/automated-hint';
import { LoadState } from '@/components/load-state';
import { PageHeader } from '@/components/page-header';
import { InfoTooltip } from '@/components/info-tooltip';
import { fmtDate } from '@/lib/datetime';
import { UserPlus, Search, Mail, Phone, Home } from 'lucide-react';
import { AddStudentModal } from '@/components/add-student-modal';
import { EditStudentModal } from '@/components/edit-student-modal';
import { useRole } from '@/lib/use-role';
import IntakePage from '@/app/app/intake/page';
import { Pencil, Trash2 } from 'lucide-react';

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

// The roster itself, filtered to one status at a time — the "Active" and
// "Trial" tabs on the page below each render this scoped to their own status,
// rather than one mixed list with inline status badges.
function StudentRoster({ status }: { status: 'active' | 'trial' }) {
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<SortKey>('name');
  const [converting, setConverting] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkWithdrawing, setBulkWithdrawing] = useState(false);
  const role = useRole();
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  // The API path IS the cache key: revisiting this page (or paging back to a
  // page you already loaded) renders instantly from cache, then revalidates in
  // the background. keepPreviousData keeps the current rows on screen while a
  // new search/page loads instead of flashing empty.
  const params = new URLSearchParams({ status, limit: String(PAGE_SIZE), offset: String(offset) });
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

  // Same teardown as the detail page's "Withdraw student" — ends every
  // enrollment, clears schedule rules, cancels future scheduled lessons at no
  // charge. Past lessons are untouched. Quick access from the list so staff
  // don't have to open each profile just to withdraw someone.
  async function withdrawOne(id: string, name: string) {
    if (!confirm(`Withdraw ${name}? This ends every enrollment, stops all their weekly lessons, and cancels all future scheduled lessons at no charge. Past lessons are unaffected. This cannot be undone from here — re-enroll them to bring them back.`)) return;
    setWithdrawingId(id);
    try {
      await apiFetch(`/students/${id}`, { method: 'DELETE', token: tok() });
      mutate();
      setSelected(prev => { const next = new Set(prev); next.delete(id); return next; });
    } catch (e) { alert(e instanceof Error ? e.message : 'Could not withdraw this student'); }
    finally { setWithdrawingId(null); }
  }

  async function withdrawSelected() {
    const targets = students.filter(s => selected.has(s.id));
    if (targets.length === 0) return;
    if (!confirm(`Withdraw ${targets.length} student${targets.length !== 1 ? 's' : ''}? This ends every enrollment, stops weekly lessons, and cancels future scheduled lessons at no charge for each of them. This cannot be undone from here.`)) return;
    setBulkWithdrawing(true);
    for (const s of targets) {
      try { await apiFetch(`/students/${s.id}`, { method: 'DELETE', token: tok() }); }
      catch { /* one failure shouldn't stop the rest */ }
    }
    setBulkWithdrawing(false);
    setSelected(new Set());
    mutate();
  }

  function toggleSelected(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelected(prev => prev.size === students.length ? new Set() : new Set(students.map(s => s.id)));
  }

  return (
    <div>
      <AddStudentModal open={showAdd} onClose={() => setShowAdd(false)} onCreated={() => mutate()} />
      <EditStudentModal open={!!editingId} onClose={() => setEditingId(null)} studentId={editingId} onSaved={() => mutate()} />
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">{status === 'active' ? 'Active students' : 'Trial students'}</span>
        }
        subtitle={`${total} student${total !== 1 ? 's' : ''}`}
        action={
          <span className="inline-flex items-center gap-1.5">
            {role === 'admin' && selected.size > 0 && (
              <button onClick={withdrawSelected} disabled={bulkWithdrawing} className="ui-btn-ghost" style={{ color: 'var(--coral)' }}>
                <Trash2 size={15} /> {bulkWithdrawing ? 'Withdrawing…' : `Withdraw (${selected.size})`}
              </button>
            )}
            {/* Kept, but marked optional — students normally arrive via Sign-ups. */}
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
        <select value={sort} onChange={e => setSort(e.target.value as SortKey)} className="ui-input shrink-0" style={{ width: 224 }}>
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
              {role === 'admin' && (
                <th>
                  <input type="checkbox" checked={selected.size > 0 && selected.size === students.length} onChange={toggleSelectAll} />
                </th>
              )}
              <th>Name</th>
              <th>Family</th>
              <th>Instruments</th>
              <th>Teachers</th>
              <th>Next lesson</th>
              <th>Credits</th>
              {role === 'admin' && <th></th>}
            </tr>
          </thead>
          <tbody>
            {students.length === 0 && (
              <tr><td colSpan={role === 'admin' ? 8 : 6} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>
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
                {role === 'admin' && (
                  <td>
                    <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelected(s.id)} />
                  </td>
                )}
                <td>
                  {/* Status lives on the detail page now — this list is a quick
                      scan, not a place to manage state. A trial student gets a
                      one-click promote button since that's a common action. */}
                  <span className="inline-flex items-center gap-2">
                    <Link href={`/app/students/${s.id}`}
                      className="font-semibold hover:underline"
                      style={{ color: 'var(--sage-dk)' }}>
                      {s.firstName} {s.lastName}
                    </Link>
                    {status === 'trial' && (
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
                          {s.family.email && (
                            <div className="flex items-center gap-1 truncate max-w-[180px]">
                              <Mail size={10} className="shrink-0" />{s.family.email}
                            </div>
                          )}
                          {s.family.phone && (
                            <div className="flex items-center gap-1">
                              <Phone size={10} className="shrink-0" />{s.family.phone}
                            </div>
                          )}
                          {s.family.address && (
                            <div className="flex items-center gap-1 truncate max-w-[180px]">
                              <Home size={10} className="shrink-0" />{s.family.address}
                            </div>
                          )}
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
                {role === 'admin' && (
                  <td>
                    <div className="flex items-center gap-2.5">
                      <button onClick={() => setEditingId(s.id)} title="Edit student" style={{ color: 'var(--sage-dk)' }}>
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => withdrawOne(s.id, `${s.firstName} ${s.lastName}`)}
                        disabled={withdrawingId === s.id} title="Withdraw student" style={{ color: 'var(--coral)' }}
                        className="disabled:opacity-50">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                )}
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

// Pending (sign-ups awaiting approval, the waiting list, enquiries and CSV
// import) is admin-only, matching /app/intake's own access rule — a teacher
// just gets the active roster with no tab bar at all.
export default function StudentsPage() {
  const role = useRole();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Kept in the URL, not local state — a plain useState reset to 'active' on
  // every mount, so browser back from a student profile always landed on
  // Active regardless of which tab was open before. router.replace (not push)
  // keeps a single history entry in sync with whatever tab is selected, so
  // back-navigation restores it without stacking a new entry per tab click.
  const tabParam = searchParams.get('tab');
  const tab: 'active' | 'trial' | 'pending' =
    tabParam === 'trial' || tabParam === 'pending' ? tabParam : 'active';
  function setTab(t: 'active' | 'trial' | 'pending') {
    router.replace(t === 'active' ? pathname : `${pathname}?tab=${t}`, { scroll: false });
  }

  if (role !== 'admin') return <StudentRoster status="active" />;

  return (
    <div>
      <div className="flex gap-1 mb-5 border-b" style={{ borderColor: 'var(--bd)' }}>
        {(['active', 'trial', 'pending'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px capitalize transition-colors"
            style={{
              borderColor: tab === t ? 'var(--sage)' : 'transparent',
              color: tab === t ? 'var(--sage)' : 'var(--txt3)',
            }}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'active' && <StudentRoster status="active" />}
      {tab === 'trial' && <StudentRoster status="trial" />}
      {tab === 'pending' && <IntakePage />}
    </div>
  );
}
