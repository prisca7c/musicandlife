'use client';

import { useState, FormEvent } from 'react';
import { apiFetch } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { useApi } from '@/lib/swr';
import { uploadFile } from '@/lib/upload';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/badge';
import { Modal } from '@/components/modal';
import { SearchableSelect } from '@/components/searchable-select';
import { linkify } from '@/lib/linkify';
import { useRole } from '@/lib/use-role';
import { Search, Lock, Download, Play, FileText } from 'lucide-react';

interface Resource {
  id: string; title: string; description: string | null; type: string; scope: string; url: string | null;
  instrument: string | null; delivery: 'download' | 'view_only';
  teacher: { id: string; firstName: string; lastName: string } | null;
  student: { id: string; firstName: string; lastName: string } | null;
  file: { id: string; mime: string; originalName: string | null } | null;
  createdAt: string;
}
interface Staff { id: string; firstName: string; lastName: string; }
interface Student { id: string; firstName: string; lastName: string; }

const SCOPE_COLORS: Record<string, string> = { studio: 'default', teacher: 'trial', family: 'active', student: 'planned' };

function AddResourceModal({ open, onClose, onCreated, role, staff, students }: {
  open: boolean; onClose: () => void; onCreated: () => void;
  role: string; staff: Staff[]; students: Student[];
}) {
  const [type, setType] = useState<'link'|'note'|'file'>('link');
  const [teacherId, setTeacherId] = useState('');
  const [studentId, setStudentId] = useState('');
  // File resources: the chosen file + how families get it. The delivery default
  // follows the file type (a video is view-only, everything else downloadable),
  // and the person publishing can override it.
  const [file, setFile] = useState<File | null>(null);
  const [delivery, setDelivery] = useState<'download' | 'view_only'>('download');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  function onPickFile(f: File | null) {
    setFile(f);
    if (f) setDelivery(f.type.startsWith('video/') ? 'view_only' : 'download');
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    try {
      let fileId: string | undefined;
      if (type === 'file') {
        if (!file) { setError('Choose a file to upload.'); setSaving(false); return; }
        // Library materials aren't ephemeral student files — keep them (expiring:false).
        const up = await uploadFile(file, tok(), { expiring: false });
        fileId = up.fileId;
      }
      await apiFetch('/resources', { method: 'POST', token: tok(), body: JSON.stringify({
        title: f.get('title'), description: f.get('description') || undefined,
        type, url: type === 'link' ? (f.get('url') || undefined) : undefined,
        fileId, delivery: type === 'file' ? delivery : undefined,
        scope: f.get('scope'),
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
            {(['link','file','note'] as const).map(t => (
              <label key={t} className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="radio" checked={type===t} onChange={()=>setType(t)} className="text-[var(--sage)]" />
                <span className="capitalize">{t}</span>
              </label>
            ))}
          </div></div>
        {type === 'link' && <div><label className="block text-sm font-medium mb-1">URL</label>
          <input name="url" type="url" className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]" /></div>}
        {type === 'file' && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">File <span className="text-red-500">*</span></label>
              <input type="file" onChange={e => onPickFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-[var(--sage-lt)] file:px-3 file:py-1.5 file:text-[var(--sage-dk)] file:font-medium" />
              {file && <p className="text-xs text-gray-400 mt-1">{file.name} · {(file.size/1024/1024).toFixed(1)} MB</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">How families get it</label>
              <div className="flex gap-2">
                {([
                  { v: 'download', label: 'Downloadable', hint: 'Sheet music, audio, worksheets' },
                  { v: 'view_only', label: 'View only', hint: 'Videos — streamed, no download' },
                ] as const).map(o => (
                  <button key={o.v} type="button" onClick={() => setDelivery(o.v)}
                    className="flex-1 text-left rounded-xl border px-3 py-2"
                    style={{
                      borderColor: delivery === o.v ? 'var(--sage)' : 'var(--bd)',
                      background: delivery === o.v ? 'var(--sage-lt)' : 'transparent',
                    }}>
                    <span className="block text-sm font-semibold">{o.label}</span>
                    <span className="block text-xs" style={{ color: 'var(--txt3)' }}>{o.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        <div><label className="block text-sm font-medium mb-1">Description</label>
          <textarea name="description" rows={type==='note'?4:2} className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]" /></div>
        <div><label className="block text-sm font-medium mb-1">Visible to</label>
          {(() => {
            // Mirror the API's publish rights: teachers may only share with the
            // teaching team — they can't broadcast to every family/student.
            const allowed = role === 'teacher' ? ['teacher']
              : role === 'receptionist' ? ['studio', 'family', 'student']
              : role === 'technician' ? ['studio']
              : ['studio', 'teacher', 'family', 'student'];
            const labels: Record<string, string> = {
              studio: 'All staff (studio)', teacher: 'Teachers only',
              family: 'Families & students', student: 'Students only',
            };
            return (
              <select name="scope" defaultValue={allowed[0]} className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]">
                {allowed.map(s => <option key={s} value={s}>{labels[s]}</option>)}
              </select>
            );
          })()}
          {role === 'teacher' && (
            <p className="text-xs text-gray-400 mt-1">To send materials to a family, add them to that student&apos;s lesson note.</p>
          )}
        </div>

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
  const role = useRole();
  // Families & students reach this page too (they subscribe to the library), but
  // the server only lets staff create/delete resources (@Roles('teacher')). Show
  // them a read-only library — no "Add"/"Remove", no staff-oriented filters —
  // rather than management controls that just 403. Only staff manage.
  const canManage = role !== 'guardian' && role !== 'student';

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

  // Subscription terms — a guardian OR a logged-in student may see the price
  // and buy access (a student may be an adult with no guardian account to do
  // it for them). Staff never see this — they manage the library, not pay for it.
  const isFamilyMember = role === 'guardian' || role === 'student';
  const { data: sub, mutate: mutateSub } = useApi<{ active: boolean; paidUntil: string | null; price: number; months: number }>(
    isFamilyMember ? '/family/resource-subscription' : null,
  );
  const [subscribing, setSubscribing] = useState(false);
  const [subError, setSubError] = useState('');
  // Charging the family real money should never happen on a single stray tap, so
  // the button opens a confirmation first and only this POSTs after they agree.
  const [confirmingSub, setConfirmingSub] = useState(false);
  const money = formatMoney;
  const period = (m: number) => (m === 1 ? 'month' : `${m} months`);

  async function subscribe() {
    setSubscribing(true); setSubError('');
    try {
      await apiFetch('/family/resource-subscription/subscribe', { method: 'POST', token: tok() });
      await mutateSub();
      await mutate();
      setConfirmingSub(false);
    } catch (err) {
      setSubError(err instanceof Error ? err.message : 'Could not start your subscription. Please try again.');
    } finally { setSubscribing(false); }
  }

  // Unfiltered lists for the filter dropdowns / add modal. Staff & student lists
  // are only for the management modal — families would 403 on those routes, so
  // don't even ask for them.
  const { data: allResources = [] } = useApi<Resource[]>('/resources');
  const { data: staff = [] } = useApi<Staff[]>(canManage ? '/staff' : null);
  const { data: students = [] } = useApi<Student[]>(canManage ? '/students' : null);

  function applyFilters(next: Partial<{ search: string; instrument: string; teacherId: string; studentId: string }>) {
    const merged = { search, instrument, teacherId, studentId, ...next };
    setSearch(merged.search); setInstrument(merged.instrument); setTeacherId(merged.teacherId); setStudentId(merged.studentId);
  }

  async function remove(id: string) {
    // Permanent delete — removes it for everyone it's shared with. Guard the
    // mis-click; the app confirms other destructive deletes too.
    if (!confirm('Remove this resource? It will be removed for everyone it’s shared with and this can’t be undone.')) return;
    setDeleting(id);
    try { await apiFetch(`/resources/${id}`, { method: 'DELETE', token: tok() }); load(); }
    catch(e) { console.error(e); } finally { setDeleting(null); }
  }

  // File resources are served through a signed, time-limited URL rather than a
  // stored link: we fetch it on click so the URL is never in the page source, and
  // a view-only item opens inline (no download control) while a downloadable one
  // is served as an attachment. The signing endpoint re-checks visibility, so a
  // student can only ever reach files they're allowed to see.
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<{ id: string; message: string } | null>(null);
  async function openFile(id: string) {
    setOpening(id); setOpenError(null);
    try {
      const { url } = await apiFetch<{ url: string }>(`/resources/${id}/file-url`, { token: tok() });
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setOpenError({ id, message: err instanceof Error ? err.message : 'Could not open this file.' });
    } finally { setOpening(null); }
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
          <p className="text-gray-700 font-medium mb-1">Unlock the resource library</p>
          {isFamilyMember && sub ? (
            <>
              <p className="text-sm text-gray-500 max-w-sm mx-auto mb-5">
                Sheet music, practice tracks and teaching materials your family can use at home.
                A subscription is <strong>{money(sub.price)}</strong> per {period(sub.months)}.
              </p>
              {subError && <p className="mb-3 text-sm text-red-600">{subError}</p>}
              <button onClick={() => { setSubError(''); setConfirmingSub(true); }} disabled={subscribing}
                className="bg-[var(--sage)] text-white rounded px-5 py-2.5 text-sm font-medium hover:bg-[var(--sage-dk)] disabled:opacity-50">
                {subscribing ? 'Setting up…' : `Subscribe — ${money(sub.price)} / ${period(sub.months)}`}
              </button>

              <Modal open={confirmingSub} onClose={() => { if (!subscribing) setConfirmingSub(false); }} title="Confirm subscription">
                <p className="text-sm text-gray-700 mb-2">
                  This will invoice you <strong>{money(sub.price)}</strong> for {period(sub.months)} of resource library access.
                </p>
                <p className="text-xs text-gray-500 mb-5">
                  The invoice is added to your account to pay by bank transfer, and the library unlocks straight away. You won&apos;t be charged twice if you already have an unpaid subscription invoice.
                </p>
                {subError && <p className="mb-3 text-sm text-red-600">{subError}</p>}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setConfirmingSub(false)} disabled={subscribing}
                    className="rounded px-4 py-2 text-sm font-medium border disabled:opacity-50"
                    style={{ borderColor: 'var(--bd)', color: 'var(--txt)' }}>
                    Cancel
                  </button>
                  <button onClick={subscribe} disabled={subscribing}
                    className="bg-[var(--sage)] text-white rounded px-4 py-2 text-sm font-medium hover:bg-[var(--sage-dk)] disabled:opacity-50">
                    {subscribing ? 'Setting up…' : `Confirm — ${money(sub.price)}`}
                  </button>
                </div>
              </Modal>
              <p className="text-xs text-gray-400 mt-3 max-w-sm mx-auto">
                We&apos;ll add this to your account as an invoice you can pay by bank transfer, and unlock the library straight away.
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-400 max-w-sm mx-auto">
              This studio&apos;s resource library requires an active subscription. Please contact the studio to set up access.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {canManage && (
        <AddResourceModal open={showAdd} onClose={()=>setShowAdd(false)} onCreated={() => load()} role={role} staff={staff} students={students} />
      )}
      <PageHeader title="Resources" subtitle={`${resources.length} item${resources.length!==1?'s':''}`}
        action={canManage
          ? <button onClick={()=>setShowAdd(true)} className="bg-[var(--sage)] text-white rounded px-4 py-2 text-sm font-medium hover:bg-[var(--sage-dk)]">+ Add resource</button>
          : undefined} />

      {/* Families get a simple search + instrument filter; the teacher/student
          filters are a staff tool (and their options are only populated from the
          staff-visible lists). */}
      <div className={`grid grid-cols-1 gap-3 mb-5 ${canManage ? 'sm:grid-cols-4' : 'sm:grid-cols-2'}`}>
        <div className="relative sm:col-span-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><Search size={14} /></span>
          <input value={search} onChange={e => applyFilters({ search: e.target.value })} placeholder="Search title or description…"
            className="w-full border rounded px-3 py-2 pl-8 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]" />
        </div>
        <SearchableSelect
          options={instrumentOptions.map(i => ({ value: i, label: i.charAt(0).toUpperCase() + i.slice(1) }))}
          value={instrument} onChange={v => applyFilters({ instrument: v })} emptyLabel="All instruments" placeholder="All instruments"
        />
        {canManage && (
          <SearchableSelect
            options={teacherOptions.map(t => ({ value: t.id, label: `${t.firstName} ${t.lastName}` }))}
            value={teacherId} onChange={v => applyFilters({ teacherId: v })} emptyLabel="All teachers" placeholder="All teachers"
          />
        )}
        {canManage && (
          <SearchableSelect
            options={studentOptions.map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
            value={studentId} onChange={v => applyFilters({ studentId: v })} emptyLabel="All students" placeholder="All students"
          />
        )}
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
              {r.type === 'file' && r.file && (
                <button onClick={() => openFile(r.id)} disabled={opening === r.id}
                  className="inline-flex items-center gap-1.5 text-xs mt-1 text-[var(--sage-dk)] hover:underline disabled:opacity-50">
                  {r.delivery === 'view_only' ? <Play size={12} /> : <Download size={12} />}
                  {opening === r.id ? 'Opening…' : r.delivery === 'view_only'
                    ? (r.file.mime.startsWith('video/') ? 'Watch video' : 'View')
                    : 'Download'}
                  <span className="text-gray-400">{r.file.originalName}</span>
                </button>
              )}
              {openError?.id === r.id && <p className="text-xs text-red-500 mt-1">{openError.message}</p>}
            </div>
            {canManage && (
              <button onClick={()=>remove(r.id)} disabled={deleting===r.id}
                className="text-xs text-red-500 hover:underline shrink-0 disabled:opacity-50">Remove</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
