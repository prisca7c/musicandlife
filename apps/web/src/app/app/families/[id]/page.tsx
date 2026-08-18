'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { useApi } from '@/lib/swr';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/badge';
import { Modal } from '@/components/modal';
import { BackButton } from '@/components/back-button';
import { Mail, Phone, Home } from 'lucide-react';
import { InvoicingSettingsFields, readInvoicingSettingsForm } from '@/components/invoicing-settings-fields';
import { invoiceStatusLabel, invoiceStatusColor } from '@/lib/invoice-status';

interface FamilyDetail {
  id: string; name: string; contactName: string | null; address: string | null;
  phone: string | null; email: string | null; autoInvoice: boolean;
  invoiceMode: 'monthly_statement' | 'per_lesson' | 'custom' | null; balanceCached: number;
  customIntervalValue: number | null; customIntervalUnit: 'day' | 'week' | 'month' | 'year' | null;
  billingStartDate: string | null; billingMode: 'prepaid' | 'postpaid';
  invoiceDateOffsetDays: number; dueDateOffsetDays: number;
  invoiceFormat: 'condensed' | 'normal' | 'expanded'; includePreviousBalance: boolean;
  autoEmailInvoice: boolean; invoiceFooterNote: string | null;
  resourceAccessPaidUntil: string | null;
  students: { id: string; firstName: string; lastName: string; status: string }[];
  guardians: { id: string; relationship: string; user: { id: string; email: string } }[];
}

// Core identity fields (name/contact/address) had no edit UI at all — PATCH
// /families/:id already supported them, but the page only ever let you edit
// billing settings and resource access, never the family's own details.
function EditFamilyModal({ open, onClose, family, onSaved }: {
  open: boolean; onClose: () => void;
  family: { id: string; name: string; contactName: string | null; phone: string | null; email: string | null; address: string | null } | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  useEffect(() => {
    if (!family) return;
    setName(family.name); setContactName(family.contactName ?? '');
    setPhone(family.phone ?? ''); setEmail(family.email ?? ''); setAddress(family.address ?? '');
    setError('');
  }, [family, open]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!family) return;
    setSaving(true); setError('');
    try {
      await apiFetch(`/families/${family.id}`, {
        method: 'PATCH', token: tok(), body: JSON.stringify({
          name, contactName: contactName || undefined, phone: phone || undefined,
          email: email || undefined, address: address || undefined,
        }),
      });
      onSaved(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit family">
      {error && (
        <div className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="ui-label">Family name <span style={{ color: 'var(--coral)' }}>*</span></label>
          <input value={name} onChange={e => setName(e.target.value)} required autoFocus className="ui-input" />
        </div>
        <div>
          <label className="ui-label">Contact name</label>
          <input value={contactName} onChange={e => setContactName(e.target.value)} className="ui-input" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ui-label">Phone</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} className="ui-input" />
          </div>
          <div>
            <label className="ui-label">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="ui-input" />
          </div>
        </div>
        <div>
          <label className="ui-label">Address</label>
          <textarea value={address} onChange={e => setAddress(e.target.value)} rows={2} className="ui-input" />
        </div>
        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving} className="ui-btn-primary">{saving ? 'Saving…' : 'Save'}</button>
          <button type="button" onClick={onClose} className="ui-btn-ghost">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

// Resource-access subscription — separate from lesson billing. Inline date editor.
function ResourceAccessCard({ family, onSaved }: { family: FamilyDetail; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(family.resourceAccessPaidUntil ?? '');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];
  const today = new Date().toISOString().split('T')[0]!;
  const active = !!family.resourceAccessPaidUntil && family.resourceAccessPaidUntil >= today;

  async function save() {
    setSaving(true);
    try {
      await apiFetch(`/families/${family.id}`, {
        method: 'PATCH', token: tok(),
        body: JSON.stringify({ resourceAccessPaidUntil: date || null }),
      });
      onSaved(); setEditing(false);
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  }

  return (
    <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-sm uppercase tracking-wider" style={{ color: 'var(--txt3)' }}>Resource access</h2>
        {!editing && (
          <button onClick={() => setEditing(true)} className="text-xs font-semibold hover:underline" style={{ color: 'var(--sage-dk)' }}>
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="ui-label">Paid until</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="ui-input" />
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="ui-btn-primary text-xs px-3 py-1.5">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => { setEditing(false); setDate(family.resourceAccessPaidUntil ?? ''); }} className="ui-btn-ghost text-xs px-3 py-1.5">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt style={{ color: 'var(--txt3)' }}>Status</dt>
            <dd className="font-medium" style={{ color: active ? 'var(--sage-dk)' : 'var(--coral)' }}>
              {active ? 'Active' : 'Inactive'}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt style={{ color: 'var(--txt3)' }}>Paid until</dt>
            <dd className="font-medium">{family.resourceAccessPaidUntil ?? 'Not set'}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function AutoInvoicingSettingsModal({ open, onClose, family, onSaved }: {
  open: boolean; onClose: () => void; family: FamilyDetail; onSaved: () => void;
}) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await apiFetch(`/families/${family.id}`, {
        method: 'PATCH', token: tok(), body: JSON.stringify(readInvoicingSettingsForm(new FormData(e.currentTarget))),
      });
      onSaved(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Auto-invoicing settings — ${family.name}`}>
      {error && (
        <div className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <InvoicingSettingsFields defaults={family} />
        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving} className="ui-btn-primary">
            {saving ? 'Saving…' : 'Save settings'}
          </button>
          <button type="button" onClick={onClose} className="ui-btn-ghost">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

// Add student — family pre-filled, no need to select it
function AddStudentModal({ open, onClose, familyId, familyName, onCreated }: {
  open: boolean; onClose: () => void; familyId: string; familyName: string; onCreated: () => void;
}) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    try {
      await apiFetch('/students', { method: 'POST', token: tok(), body: JSON.stringify({
        familyId, firstName: f.get('firstName'), lastName: f.get('lastName'),
        dob: f.get('dob') || undefined, email: f.get('email') || undefined,
        status: f.get('status'), notes: f.get('notes') || undefined,
      })});
      onCreated(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Add student — ${familyName}`}>
      {error && (
        <div className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ui-label">First name <span style={{ color: 'var(--coral)' }}>*</span></label>
            <input name="firstName" required autoFocus className="ui-input" />
          </div>
          <div>
            <label className="ui-label">Last name <span style={{ color: 'var(--coral)' }}>*</span></label>
            <input name="lastName" required className="ui-input" />
          </div>
        </div>
        <div>
          <label className="ui-label">Date of birth</label>
          <input name="dob" type="date" className="ui-input" />
        </div>
        <div>
          <label className="ui-label">
            Student email{' '}
            <span className="font-normal text-[11px]" style={{ color: 'var(--txt4)' }}>(optional — creates portal login)</span>
          </label>
          <input name="email" type="email" className="ui-input" />
        </div>
        <div>
          <label className="ui-label">Status</label>
          <select name="status" defaultValue="active" className="ui-input">
            <option value="trial">Trial</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </div>
        <div>
          <label className="ui-label">Notes</label>
          <textarea name="notes" rows={2} className="ui-input" style={{ resize: 'vertical' }} />
        </div>
        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving} className="ui-btn-primary">
            {saving ? 'Saving…' : 'Add student'}
          </button>
          <button type="button" onClick={onClose} className="ui-btn-ghost">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

// Create invoice — family pre-filled
function CreateInvoiceModal({ open, onClose, familyId, familyName, invoiceMode, onCreated }: {
  open: boolean; onClose: () => void; familyId: string; familyName: string; invoiceMode: string | null; onCreated: () => void;
}) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];
  const lastMonthStart = new Date(); lastMonthStart.setDate(1); lastMonthStart.setMonth(lastMonthStart.getMonth()-1);
  const lastMonthEnd = new Date(); lastMonthEnd.setDate(0);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    try {
      const inv = await apiFetch<{id:string}>('/invoices', { method: 'POST', token: tok(), body: JSON.stringify({
        familyId, mode: f.get('mode'),
        periodStart: f.get('periodStart') || undefined, periodEnd: f.get('periodEnd') || undefined,
        notes: f.get('notes') || undefined,
      })});
      onCreated(); onClose();
      window.location.href = `/app/billing/${inv.id}`;
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Create invoice — ${familyName}`}>
      {error && (
        <div className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="ui-label">Mode</label>
          <select name="mode" defaultValue={invoiceMode ?? 'monthly_statement'} className="ui-input">
            <option value="monthly_statement">Monthly statement</option>
            <option value="per_lesson">Per lesson</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ui-label">Period start</label>
            <input name="periodStart" type="date" defaultValue={lastMonthStart.toISOString().split('T')[0]} className="ui-input" />
          </div>
          <div>
            <label className="ui-label">Period end</label>
            <input name="periodEnd" type="date" defaultValue={lastMonthEnd.toISOString().split('T')[0]} className="ui-input" />
          </div>
        </div>
        <div>
          <label className="ui-label">Notes</label>
          <textarea name="notes" rows={2} className="ui-input" style={{ resize: 'vertical' }} />
        </div>
        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving} className="ui-btn-primary">
            {saving ? 'Creating…' : 'Create & open invoice'}
          </button>
          <button type="button" onClick={onClose} className="ui-btn-ghost">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

interface FamilyInvoice { id: string; number: string; status: string; total: number; issuedOn: string; dueDate: string; }

// Absorb a duplicate family into this one. The picked family is the SOURCE
// (deleted); the family on the page is the target that survives.
function MergeFamilyModal({ open, onClose, targetId, targetName, onMerged }: {
  open: boolean; onClose: () => void; targetId: string; targetName: string; onMerged: () => void;
}) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<{ id: string; name: string }[]>([]);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState('');
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  useEffect(() => {
    if (!open || !search.trim()) { setResults([]); return; }
    const q = search;
    apiFetch<{ id: string; name: string }[]>(`/families?search=${encodeURIComponent(q)}`, { token: tok() })
      .then(rows => setResults(rows.filter(r => r.id !== targetId).slice(0, 8)))
      .catch(() => setResults([]));
  }, [search, open, targetId]);

  async function doMerge() {
    if (!picked) return;
    setMerging(true); setError('');
    try {
      await apiFetch(`/families/${targetId}/merge`, {
        method: 'POST', token: tok(), body: JSON.stringify({ sourceFamilyId: picked.id }),
      });
      onMerged(); onClose(); setPicked(null); setSearch('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not merge families'); }
    finally { setMerging(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Merge a duplicate family">
      {!picked ? (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--txt3)' }}>
            Find the duplicate to merge <strong>into {targetName}</strong>. The one you pick will be absorbed and removed.
          </p>
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search families by name…" className="ui-input" />
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {results.map(r => (
              <button key={r.id} onClick={() => setPicked(r)}
                className="w-full text-left text-sm px-3 py-2 rounded-lg border hover:bg-[var(--surf)]"
                style={{ borderColor: 'var(--bd2)', color: 'var(--txt)' }}>
                {r.name}
              </button>
            ))}
            {search.trim() && results.length === 0 && (
              <p className="text-sm px-1 py-2" style={{ color: 'var(--txt4)' }}>No other families match.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--txt)' }}>
            Merge <strong>{picked.name}</strong> into <strong>{targetName}</strong>? All of {picked.name}&apos;s students,
            guardians, invoices and balance move to {targetName}, and {picked.name} is deleted.
          </p>
          <p className="text-xs" style={{ color: 'var(--coral)' }}>This can&apos;t be undone.</p>
          {error && <p className="text-sm text-[var(--coral)]">{error}</p>}
          <div className="flex gap-2">
            <button onClick={doMerge} disabled={merging} className="ui-btn-primary disabled:opacity-60">
              {merging ? 'Merging…' : `Merge into ${targetName}`}
            </button>
            <button onClick={() => setPicked(null)} disabled={merging} className="ui-btn-ghost">Back</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function FamilyDetailPage() {
  const params = useParams<{ id: string }>();
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [showCreateInvoice, setShowCreateInvoice] = useState(false);
  const [showInvoicingSettings, setShowInvoicingSettings] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [showEditFamily, setShowEditFamily] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  // Merge is destructive → managers and above only (mirrors the API's @Roles).
  const [canMerge, setCanMerge] = useState(false);
  useEffect(() => {
    try {
      const role = JSON.parse(atob((tok() ?? '').split('.')[1] || ''))?.role;
      setCanMerge(role === 'admin');
    } catch { setCanMerge(false); }
  }, []);

  // Cached reads — instant on revisit. load() refreshes both after a mutation.
  const { data: family = null, mutate: mFamily } = useApi<FamilyDetail>(`/families/${params.id}`);
  const { data: invoices = [], mutate: mInvoices } = useApi<FamilyInvoice[]>(`/invoices?familyId=${params.id}`);
  const load = () => { mFamily(); mInvoices(); };

  if (!family) return <div className="p-8 text-center text-sm" style={{ color: 'var(--txt4)' }}>Loading…</div>;

  return (
    <div>
      {family && <AddStudentModal open={showAddStudent} onClose={() => setShowAddStudent(false)}
        familyId={family.id} familyName={family.name} onCreated={load} />}
      {family && <CreateInvoiceModal open={showCreateInvoice} onClose={() => setShowCreateInvoice(false)}
        familyId={family.id} familyName={family.name} invoiceMode={family.invoiceMode} onCreated={load} />}
      {family && <AutoInvoicingSettingsModal open={showInvoicingSettings} onClose={() => setShowInvoicingSettings(false)}
        family={family} onSaved={load} />}
      {family && <MergeFamilyModal open={showMerge} onClose={() => setShowMerge(false)}
        targetId={family.id} targetName={family.name} onMerged={load} />}
      <EditFamilyModal open={showEditFamily} onClose={() => setShowEditFamily(false)} family={family} onSaved={load} />

      <div className="mb-5">
        <BackButton label="Families" fallbackHref="/app/families" />
      </div>
      <PageHeader
        title={family.contactName || family.name}
        subtitle={family.contactName && family.contactName !== family.name ? family.name : undefined}
        action={
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold"
              style={{ color: family.balanceCached < 0 ? 'var(--coral)' : 'var(--txt3)' }}>
              Balance: {formatMoney(Math.abs(family.balanceCached))}{family.balanceCached < 0 ? ' owed' : ''}
            </span>
            <button onClick={() => setShowCreateInvoice(true)} className="ui-btn-ghost text-sm">
              Create invoice
            </button>
            {canMerge && (
              <button onClick={() => setShowMerge(true)} className="ui-btn-ghost text-sm" title="Absorb a duplicate family into this one">
                Merge duplicate
              </button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-sm uppercase tracking-wider" style={{ color: 'var(--txt3)' }}>Contact</h2>
              <button onClick={() => setShowEditFamily(true)}
                className="text-[11px] font-semibold hover:underline" style={{ color: 'var(--sage-dk)' }}>
                Edit
              </button>
            </div>
            <dl className="space-y-3 text-sm">
              {family.email && (
                <div className="flex justify-between gap-3">
                  <dt className="flex items-center gap-1.5" style={{ color: 'var(--txt3)' }}>
                    <Mail size={13} /> Email
                  </dt>
                  <dd className="font-medium text-right">{family.email}</dd>
                </div>
              )}
              {family.phone && (
                <div className="flex justify-between gap-3">
                  <dt className="flex items-center gap-1.5" style={{ color: 'var(--txt3)' }}>
                    <Phone size={13} /> Phone
                  </dt>
                  <dd className="font-medium">{family.phone}</dd>
                </div>
              )}
              {family.address && (
                <div>
                  <dt className="mb-1 flex items-center gap-1.5" style={{ color: 'var(--txt3)' }}>
                    <Home size={13} /> Address
                  </dt>
                  <dd className="font-medium leading-snug">{family.address}</dd>
                </div>
              )}
            </dl>
          </div>
          <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-sm uppercase tracking-wider" style={{ color: 'var(--txt3)' }}>Billing</h2>
              <button onClick={() => setShowInvoicingSettings(true)} className="text-xs font-semibold hover:underline" style={{ color: 'var(--sage-dk)' }}>
                Edit
              </button>
            </div>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt style={{ color: 'var(--txt3)' }}>Invoice mode</dt>
                <dd className="font-medium capitalize" style={!family.invoiceMode ? { color: 'var(--txt4)', fontStyle: 'italic' } : undefined}>
                  {family.invoiceMode === 'custom' && family.customIntervalValue && family.customIntervalUnit
                    ? `Every ${family.customIntervalValue} ${family.customIntervalUnit}${family.customIntervalValue !== 1 ? 's' : ''}`
                    : family.invoiceMode ? family.invoiceMode.replace('_', ' ') : 'Not set'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: 'var(--txt3)' }}>Auto-invoice</dt>
                <dd className="font-medium">{family.autoInvoice ? 'Yes' : 'No'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: 'var(--txt3)' }}>Billing mode</dt>
                <dd className="font-medium capitalize">{family.billingMode}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: 'var(--txt3)' }}>Auto-email invoice</dt>
                <dd className="font-medium">{family.autoEmailInvoice ? 'Yes' : 'No'}</dd>
              </div>
            </dl>
          </div>
          <ResourceAccessCard family={family} onSaved={load} />
          {family.guardians.length > 0 && (
            <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
              <h2 className="font-bold mb-4 text-sm uppercase tracking-wider" style={{ color: 'var(--txt3)' }}>Guardians</h2>
              <ul className="space-y-3 text-sm">
                {family.guardians.map(g => (
                  <li key={g.id} className="flex justify-between gap-3">
                    <span className="capitalize" style={{ color: 'var(--txt3)' }}>{g.relationship}</span>
                    <span className="font-medium">{g.user.email}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          <div className="data-table-wrap overflow-hidden">
            <div className="px-5 py-3.5 border-b flex items-center justify-between"
              style={{ borderColor: 'var(--bd)', background: 'var(--surf)' }}>
              <h2 className="font-bold text-sm" style={{ color: 'var(--txt)' }}>
                Students ({family.students.length})
              </h2>
              <button onClick={() => setShowAddStudent(true)} className="ui-btn-primary text-xs px-3 py-1.5">
                + Add student
              </button>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {family.students.length === 0 && (
                  <tr><td colSpan={2} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>
                    No students yet.
                  </td></tr>
                )}
                {family.students.map(s => (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/app/students/${s.id}`}
                        className="font-semibold hover:underline"
                        style={{ color: 'var(--sage-dk)' }}>
                        {s.firstName} {s.lastName}
                      </Link>
                    </td>
                    <td><Badge variant={s.status}>{s.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="data-table-wrap overflow-hidden mt-6">
            <div className="px-5 py-3.5 border-b" style={{ borderColor: 'var(--bd)', background: 'var(--surf)' }}>
              <h2 className="font-bold text-sm" style={{ color: 'var(--txt)' }}>
                Invoices ({invoices.length})
              </h2>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Issued</th>
                  <th>Due</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--txt4)' }}>
                    No invoices yet.
                  </td></tr>
                )}
                {invoices.map(i => (
                  <tr key={i.id}>
                    <td>
                      <Link href={`/app/billing/${i.id}`} className="font-semibold hover:underline" style={{ color: 'var(--sage-dk)' }}>
                        {i.number}
                      </Link>
                    </td>
                    <td style={{ color: 'var(--txt3)' }}>{i.issuedOn}</td>
                    <td style={{ color: 'var(--txt3)' }}>{i.dueDate}</td>
                    <td className="font-semibold" style={{ textAlign: 'right' }}>
                      {i.total < 0
                        ? <span title="Credit note — money owed to the family, not by them">{formatMoney(Math.abs(i.total))} credit</span>
                        : formatMoney(i.total)}
                    </td>
                    <td><Badge variant={invoiceStatusColor(i)}>{invoiceStatusLabel(i)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
