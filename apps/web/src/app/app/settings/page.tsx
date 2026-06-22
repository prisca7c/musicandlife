'use client';

import { useState, useEffect, FormEvent } from 'react';
import { apiFetch } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/badge';
import { Modal } from '@/components/modal';
import { Building2, Receipt, Calendar, Plus, Check, Bell } from 'lucide-react';

interface NotificationRule {
  id: string; triggerEvent: string; channels: string[]; templateId: string; enabled: boolean;
}

const EVENT_LABELS: Record<string, string> = {
  'registration.received': 'New registration received',
  'registration.approved': 'Registration approved',
  'registration.denied': 'Registration denied',
  'lesson.reminder_24h': 'Lesson reminder (24h before)',
  'lesson.reminder_2h': 'Lesson reminder (2h before)',
  'lesson.cancelled': 'Lesson cancelled',
  'lesson.rescheduled': 'Lesson rescheduled',
  'invoice.sent': 'Invoice sent to family',
  'payroll.approved': 'Payroll run approved',
};

interface OrgSettings {
  id: string; name: string; timezone: string; currency: string;
  settings: {
    address?: string; contactEmail?: string; contactPhone?: string;
    bankSortCode?: string; bankAccountNumber?: string; bankAccountName?: string;
    invoiceDueDays?: number; invoiceNotes?: string;
  };
}
interface Term { id: string; name: string; startsOn: string; endsOn: string; weekCount: number; status: string; }

const inputCls = 'w-full border-[1.5px] border-[var(--bd2)] rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-[var(--sage)] focus:shadow-[0_0_0_3px_var(--sage-lt)] transition-all';
const labelCls = 'block text-xs font-semibold text-[var(--txt2)] mb-1.5 tracking-wide';

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-[var(--bd)] overflow-hidden">
      <div className="flex items-center gap-2.5 px-6 py-4 border-b border-[var(--bd)]"
        style={{ background: 'linear-gradient(135deg,var(--sage-lt),transparent)' }}>
        <span className="text-[var(--sage)]">{icon}</span>
        <h2 className="font-bold text-[var(--txt)]">{title}</h2>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

function AddTermModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    try {
      await apiFetch('/terms', { method: 'POST', token: tok(), body: JSON.stringify({
        name: f.get('name'), startsOn: f.get('startsOn'), endsOn: f.get('endsOn'),
        weekCount: parseInt(f.get('weekCount') as string) || 12, status: 'planned',
      })});
      onCreated(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create term">
      {error && <p className="mb-3 text-sm text-[var(--coral)] bg-[var(--coral-lt)] border border-[var(--coral)] rounded-xl px-3 py-2">{error}</p>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div><label className={labelCls}>Term name <span className="text-[var(--coral)]">*</span></label>
          <input name="name" required autoFocus placeholder="e.g. Autumn Term 2026" className={inputCls} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Start date <span className="text-[var(--coral)]">*</span></label>
            <input name="startsOn" type="date" required className={inputCls} /></div>
          <div><label className={labelCls}>End date <span className="text-[var(--coral)]">*</span></label>
            <input name="endsOn" type="date" required className={inputCls} /></div>
        </div>
        <div><label className={labelCls}>Number of lessons</label>
          <input name="weekCount" type="number" min="1" max="52" defaultValue="12" className={inputCls} /></div>
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving}
            className="bg-[var(--sage)] text-white rounded-xl px-5 py-2.5 text-sm font-bold hover:bg-[var(--sage-dk)] disabled:opacity-50">
            {saving ? 'Creating…' : 'Create term'}
          </button>
          <button type="button" onClick={onClose} className="rounded-xl px-5 py-2.5 text-sm border border-[var(--bd2)] hover:bg-[var(--surf)]">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

export default function SettingsPage() {
  const [org, setOrg] = useState<OrgSettings | null>(null);
  const [terms, setTerms] = useState<Term[]>([]);
  const [showAddTerm, setShowAddTerm] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [toggling, setToggling] = useState<string | null>(null);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  useEffect(() => {
    const t = tok();
    apiFetch<OrgSettings>('/organizations/me', { token: t }).then(setOrg).catch(() => {});
    apiFetch<Term[]>('/terms', { token: t }).then(setTerms).catch(() => {});
    apiFetch<NotificationRule[]>('/notification-rules', { token: t }).then(setRules).catch(() => {});
  }, []);

  async function saveSection(section: string, data: Record<string, string | number>) {
    setSaving(section);
    try {
      await apiFetch('/organizations/me', { method: 'PATCH', token: tok(), body: JSON.stringify(data) });
      setSaved(section);
      setTimeout(() => setSaved(null), 2500);
      const updated = await apiFetch<OrgSettings>('/organizations/me', { token: tok() });
      setOrg(updated);
    } catch (e) { console.error(e); }
    finally { setSaving(null); }
  }

  async function toggleRule(id: string, enabled: boolean) {
    setToggling(id);
    try {
      await apiFetch(`/notification-rules/${id}`, { method: 'PATCH', token: tok(), body: JSON.stringify({ enabled }) });
      setRules(r => r.map(rule => rule.id === id ? { ...rule, enabled } : rule));
    } catch (e) { console.error(e); }
    finally { setToggling(null); }
  }

  async function setTermStatus(id: string, status: 'planned'|'active'|'closed') {
    await apiFetch(`/terms/${id}/status`, { method: 'PATCH', token: tok(), body: JSON.stringify({ status }) }).catch(() => {});
    const updated = await apiFetch<Term[]>('/terms', { token: tok() });
    setTerms(updated);
  }

  if (!org) return <div className="p-8 text-center" style={{ color: 'var(--txt4)' }}>Loading…</div>;
  const s = org.settings ?? {};

  return (
    <div className="space-y-6 max-w-3xl">
      <AddTermModal open={showAddTerm} onClose={() => setShowAddTerm(false)} onCreated={async () => {
        const t = await apiFetch<Term[]>('/terms', { token: tok() }); setTerms(t);
      }} />
      <PageHeader title="Settings" subtitle="Studio configuration" />

      {/* Studio details */}
      <Section title="Studio details" icon={<Building2 size={18} />}>
        <form onSubmit={async e => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          await saveSection('studio', {
            name: f.get('name') as string,
            settings: JSON.stringify({
              ...s,
              address: f.get('address'), contactEmail: f.get('contactEmail'),
              contactPhone: f.get('contactPhone'),
            }),
          });
        }} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2"><label className={labelCls}>Studio name</label>
            <input name="name" defaultValue={org.name} className={inputCls} /></div>
          <div className="sm:col-span-2"><label className={labelCls}>Address</label>
            <input name="address" defaultValue={s.address ?? ''} placeholder="High Street, Pinner, HA5" className={inputCls} /></div>
          <div><label className={labelCls}>Contact email</label>
            <input name="contactEmail" type="email" defaultValue={s.contactEmail ?? ''} className={inputCls} /></div>
          <div><label className={labelCls}>Contact phone</label>
            <input name="contactPhone" defaultValue={s.contactPhone ?? ''} className={inputCls} /></div>
          <div className="sm:col-span-2 flex items-center gap-3">
            <button type="submit" disabled={saving === 'studio'}
              className="bg-[var(--sage)] text-white rounded-xl px-5 py-2.5 text-sm font-bold hover:bg-[var(--sage-dk)] disabled:opacity-50 flex items-center gap-2">
              {saving === 'studio' ? 'Saving…' : saved === 'studio' ? <><Check size={14} /> Saved</> : 'Save changes'}
            </button>
          </div>
        </form>
      </Section>

      {/* Invoice defaults */}
      <Section title="Invoice defaults" icon={<Receipt size={18} />}>
        <form onSubmit={async e => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          await saveSection('invoice', {
            settings: JSON.stringify({
              ...s,
              invoiceDueDays: parseInt(f.get('invoiceDueDays') as string) || 7,
              bankAccountName: f.get('bankAccountName'),
              bankSortCode: f.get('bankSortCode'),
              bankAccountNumber: f.get('bankAccountNumber'),
              invoiceNotes: f.get('invoiceNotes'),
            }),
          });
        }} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className={labelCls}>Payment due (days)</label>
            <input name="invoiceDueDays" type="number" min="1" defaultValue={s.invoiceDueDays ?? 7} className={inputCls} /></div>
          <div><label className={labelCls}>Account name</label>
            <input name="bankAccountName" defaultValue={s.bankAccountName ?? ''} placeholder="Music & Life" className={inputCls} /></div>
          <div><label className={labelCls}>Sort code</label>
            <input name="bankSortCode" defaultValue={s.bankSortCode ?? ''} placeholder="12-34-56" className={inputCls} /></div>
          <div><label className={labelCls}>Account number</label>
            <input name="bankAccountNumber" defaultValue={s.bankAccountNumber ?? ''} placeholder="12345678" className={inputCls} /></div>
          <div className="sm:col-span-2"><label className={labelCls}>Invoice footer notes</label>
            <textarea name="invoiceNotes" rows={2} defaultValue={s.invoiceNotes ?? ''}
              placeholder="e.g. Please make payment by bank transfer. Thank you for your business."
              className={`${inputCls} resize-y`} /></div>
          <div className="sm:col-span-2">
            <button type="submit" disabled={saving === 'invoice'}
              className="bg-[var(--sage)] text-white rounded-xl px-5 py-2.5 text-sm font-bold hover:bg-[var(--sage-dk)] disabled:opacity-50 flex items-center gap-2">
              {saving === 'invoice' ? 'Saving…' : saved === 'invoice' ? <><Check size={14} /> Saved</> : 'Save changes'}
            </button>
          </div>
        </form>
      </Section>

      {/* Notification rules */}
      <Section title="Notification rules" icon={<Bell size={18} />}>
        <div className="overflow-hidden rounded-xl border border-[var(--bd)]">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Event</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Channels</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Enabled</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rules.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400 text-xs">No rules configured. They&apos;re seeded automatically on first use.</td></tr>}
              {rules.map(rule => (
                <tr key={rule.id} className={rule.enabled ? '' : 'opacity-50'}>
                  <td className="px-4 py-3 font-medium text-xs">{EVENT_LABELS[rule.triggerEvent] ?? rule.triggerEvent}</td>
                  <td className="px-4 py-3 text-gray-600 capitalize text-xs">{rule.channels.join(', ')}</td>
                  <td className="px-4 py-3">
                    <button disabled={toggling === rule.id} onClick={() => toggleRule(rule.id, !rule.enabled)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${rule.enabled ? 'bg-[var(--sage)]' : 'bg-gray-200'} disabled:opacity-50`}>
                      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${rule.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs" style={{ color: 'var(--txt4)' }}>Lesson reminders run hourly via a background job. SMS requires a provider configured in settings.</p>
      </Section>

      {/* Terms */}
      <Section title="Academic terms" icon={<Calendar size={18} />}>
        <div className="flex justify-end mb-4">
          <button onClick={() => setShowAddTerm(true)}
            className="flex items-center gap-1.5 bg-[var(--sage)] text-white rounded-xl px-4 py-2 text-sm font-bold hover:bg-[var(--sage-dk)]">
            <Plus size={14} /> Create term
          </button>
        </div>
        <div className="space-y-2">
          {terms.length === 0 && <p className="text-sm py-4 text-center" style={{ color: 'var(--txt4)' }}>No terms yet.</p>}
          {terms.map(t => (
            <div key={t.id} className="flex items-center justify-between px-4 py-3 border border-[var(--bd)] rounded-xl">
              <div>
                <p className="font-semibold text-sm" style={{ color: 'var(--txt)' }}>{t.name}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--txt3)' }}>
                  {t.startsOn} – {t.endsOn} · {t.weekCount} lessons
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={t.status}>{t.status}</Badge>
                {t.status === 'planned' && (
                  <button onClick={() => setTermStatus(t.id, 'active')}
                    className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-[var(--sage-md)] text-[var(--sage)] hover:bg-[var(--sage-lt)]">
                    Activate
                  </button>
                )}
                {t.status === 'active' && (
                  <button onClick={() => setTermStatus(t.id, 'closed')}
                    className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-[var(--bd2)] text-[var(--txt3)] hover:bg-[var(--surf)]">
                    Close
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
