'use client';

import { useState, FormEvent } from 'react';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/badge';
import { Modal } from '@/components/modal';
import { SearchableSelect } from '@/components/searchable-select';
import { linkify } from '@/lib/linkify';
import { Search, Lock } from 'lucide-react';

interface Resource {
  id: string; title: string; description: string | null; type: string; scope: string; url: string | null;
  instrument: string | null;
  teacher: { id: string; firstName: string; lastName: string } | null;
  student: { id: string; firstName: string; lastName: string } | null;
  file: { id: string; mime: string; originalName: string | null } | null;
  createdAt: string;
}
interface Staff { id: string; firstName: string; lastName: string; }
interface Student { id: string; firstName: string; lastName: string; }

const SCOPE_COLORS: Record<string, string> = { studio: 'default', teacher: 'trial', family: 'active', student: 'planned' };

function getRoleFromToken(token?: string): string {
  try {
    if (!token) return '';
    const payload = JSON.parse(atob(token.split('.')[1]!));
    return payload.role ?? '';
  } catch { return ''; }
}

function AddResourceModal({ open, onClose, onCreated, role, staff, students }: {
  open: boolean; onClose: () => void; onCreated: () => void;
  role: string; staff: Staff[]; students: Student[];
}) {
  const [type, setType] = useState<'link'|'note'>('link');
  const [teacherId, setTeacherId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    try {
      await apiFetch('/resources', { method: 'POST', token: tok(), body: JSON.stringify({
        title: f.get('title'), description: f.get('description') || undefined,
        type, url: f.get('url') || undefined, scope: f.get('scope'),
        instrument: f.get('instrument') || undefined,
        teacherId: teacherId || undefined, studentId: studentId || undefined,
      })});
      onCreated(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add resource">
      {error && <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div><label className="block text-sm font-medium mb-1">Title <span className="text-red-500">*</span></label>
          <input name="title" required autoFocus className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]" /></div>
        <div><label className="block text-sm font-medium mb-1">Type</label>
          <div className="flex gap-4">
            {(['link','note'] as const).map(t => (
              <label key={t} className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="radio" checked={type===t} onChange={()=>setType(t)} className="text-[var(--sage)]" />
                <span className="capitalize">{t}</span>
              </label>
            ))}
          </div></div>
        {type === 'link' && <div><label className="block text-sm font-medium mb-1">URL</label>
          <input name="url" type="url" className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]" /></div>}
        <div><label className="block text-sm font-medium mb-1">Description</label>
          <textarea name="description" rows={type==='note'?4:2} className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]" /></div>
        <div><label className="block text-sm font-medium mb-1">Visible to</label>
          <select name="scope" className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]">
            <option value="studio">All staff (studio)</option>
            <option value="teacher">Teachers only</option>
            <option value="family">Families & students</option>
            <option value="student">Students only</option>
          </select></div>

        <div className="border-t pt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Instrument tag</label>
            <input name="instrument" placeholder="e.g. piano" className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]" />
          </div>
          {role !== 'teacher' && (
            <div>
              <label className="block text-sm font-medium mb-1">Teacher tag</label>
              <SearchableSelect
                options={staff.map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
                value={teacherId} onChange={setTeacherId} emptyLabel="None" placeholder="None"
              />
            </div>
          )}
          <div className={role !== 'teacher' ? 'sm:col-span-2' : ''}>
            <label className="block text-sm font-medium mb-1">Student tag</label>
            <SearchableSelect
              options={students.map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
              value={studentId} onChange={setStudentId} emptyLabel="None" placeholder="None"
            />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving} className="bg-[var(--sage)] text-white rounded px-4 py-2 text-sm font-medium hover:bg-[var(--sage-dk)] disabled:opacity-50">{saving?'Saving…':'Add resource'}</button>
          <button type="button" onClick={onClose} className="rounded px-4 py-2 text-sm border hover:bg-gray-50">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

export default function ResourcesPage() {
  const [search, setSearch] = useState('');
  const [instrument, setInstrument] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [deleting, setDeleting] = useState<string|null>(null);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];
  const role = getRoleFromToken(tok());

  // The filter set is the cache key — changing a filter re-keys and refetches;
  // revisiting with the same filters renders instantly. A rejected read (403)
  // surfaces as `locked`. mutate() refreshes after add/delete.
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (instrument) params.set('instrument', instrument);
  if (teacherId) params.set('teacherId', teacherId);
  if (studentId) params.set('studentId', studentId);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const { data: resources = [], error: resourcesError, mutate } = useApi<Resource[]>(`/resources${qs}`);
  const locked = !!resourcesError;
  const load = () => mutate();

  // Unfiltered lists for the filter dropdowns / add modal.
  const { data: allResources = [] } = useApi<Resource[]>('/resources');
  const { data: staff = [] } = useApi<Staff[]>('/staff');
  const { data: students = [] } = useApi<Student[]>('/students');

  function applyFilters(next: Partial<{ search: string; instrument: string; teacherId: string; studentId: string }>) {
    const merged = { search, instrument, teacherId, studentId, ...next };
    setSearch(merged.search); setInstrument(merged.instrument); setTeacherId(merged.teacherId); setStudentId(merged.studentId);
  }

  async function remove(id: string) {
    setDeleting(id);
    try { await apiFetch(`/resources/${id}`, { method: 'DELETE', token: tok() }); load(); }
    catch(e) { console.error(e); } finally { setDeleting(null); }
  }

  const instrumentOptions = [...new Set(allResources.map(r => r.instrument).filter((v): v is string => !!v))];
  const teacherOptions = [...new Map(allResources.filter(r => r.teacher).map(r => [r.teacher!.id, r.teacher!])).values()];
  const studentOptions = [...new Map(allResources.filter(r => r.student).map(r => [r.student!.id, r.student!])).values()];

  if (locked) {
    return (
      <div>
        <PageHeader title="Resources" />
        <div className="bg-white rounded-lg border px-6 py-16 text-center">
          <Lock size={28} className="mx-auto mb-3 text-gray-300" />
          <p className="text-gray-700 font-medium mb-1">Resource access required</p>
          <p className="text-sm text-gray-400 max-w-sm mx-auto">
            This studio&apos;s resource library requires an active subscription. Please contact the studio to renew access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <AddResourceModal open={showAdd} onClose={()=>setShowAdd(false)} onCreated={() => load()} role={role} staff={staff} students={students} />
      <PageHeader title="Resources" subtitle={`${resources.length} item${resources.length!==1?'s':''}`}
        action={<button onClick={()=>setShowAdd(true)} className="bg-[var(--sage)] text-white rounded px-4 py-2 text-sm font-medium hover:bg-[var(--sage-dk)]">+ Add resource</button>} />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-5">
        <div className="relative sm:col-span-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><Search size={14} /></span>
          <input value={search} onChange={e => applyFilters({ search: e.target.value })} placeholder="Search title or description…"
            className="w-full border rounded px-3 py-2 pl-8 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]" />
        </div>
        <select value={instrument} onChange={e => applyFilters({ instrument: e.target.value })} className="border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]">
          <option value="">All instruments</option>
          {instrumentOptions.map(i => <option key={i} value={i} className="capitalize">{i}</option>)}
        </select>
        <select value={teacherId} onChange={e => applyFilters({ teacherId: e.target.value })} className="border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]">
          <option value="">All teachers</option>
          {teacherOptions.map(t => <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>)}
        </select>
        <select value={studentId} onChange={e => applyFilters({ studentId: e.target.value })} className="border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]">
          <option value="">All students</option>
          {studentOptions.map(s => <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>)}
        </select>
      </div>

      <div className="space-y-2">
        {resources.length === 0 && <div className="bg-white rounded-lg border px-4 py-12 text-center text-gray-400">No resources match your filters.</div>}
        {resources.map(r => (
          <div key={r.id} className="bg-white rounded-lg border px-4 py-3 flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-gray-900 truncate">{r.title}</span>
                <Badge variant={SCOPE_COLORS[r.scope]}>{r.scope}</Badge>
                <span className="text-xs text-gray-400 capitalize">{r.type}</span>
                {r.instrument && <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5 capitalize">{r.instrument}</span>}
                {r.teacher && <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">{r.teacher.firstName} {r.teacher.lastName}</span>}
                {r.student && <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">{r.student.firstName} {r.student.lastName}</span>}
              </div>
              {r.description && <p className="text-sm text-gray-500 mt-0.5 break-words">{linkify(r.description)}</p>}
              {r.url && <div className="text-xs mt-0.5 truncate">{linkify(r.url)}</div>}
            </div>
            <button onClick={()=>remove(r.id)} disabled={deleting===r.id}
              className="text-xs text-red-500 hover:underline shrink-0 disabled:opacity-50">Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}
