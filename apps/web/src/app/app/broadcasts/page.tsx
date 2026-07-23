'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { PageHeader } from '@/components/page-header';
import { Modal } from '@/components/modal';
import { Send, Check, AlertTriangle } from 'lucide-react';

type Audience = 'families' | 'teachers' | 'students' | 'everyone';
type Counts = Record<Audience, number>;

const AUDIENCE_LABEL: Record<Audience, string> = {
  families: 'Families (parents & guardians)',
  teachers: 'Teachers',
  students: 'Students',
  everyone: 'Everyone',
};

export default function BroadcastsPage() {
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];
  const { data: counts } = useApi<Counts>('/broadcasts/audiences');

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<Audience>('families');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [testing, setTesting] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const ready = subject.trim().length > 0 && body.trim().length > 0;
  const recipientCount = counts?.[audience] ?? 0;

  async function sendTest() {
    setTesting(true); setNotice(null);
    try {
      const res = await apiFetch<{ sentTo: string }>('/broadcasts/test', {
        method: 'POST', token: tok(),
        body: JSON.stringify({ subject, body }),
      });
      setNotice({ kind: 'ok', text: `Test sent to you (${res.sentTo}). Check it looks right before sending to everyone.` });
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : 'Could not send the test.' });
    } finally { setTesting(false); }
  }

  async function sendToAudience() {
    setSending(true); setNotice(null);
    try {
      const res = await apiFetch<{ sent: number; failed: number; total: number }>('/broadcasts/send', {
        method: 'POST', token: tok(),
        body: JSON.stringify({ subject, body, audience, confirm: true }),
      });
      setConfirmOpen(false);
      const failedNote = res.failed > 0 ? ` ${res.failed} could not be delivered.` : '';
      setNotice({ kind: res.failed > 0 ? 'err' : 'ok', text: `Sent to ${res.sent} of ${res.total} recipients.${failedNote}` });
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : 'Could not send the email.' });
    } finally { setSending(false); }
  }

  return (
    <div>
      <PageHeader title="Email everyone" subtitle="Send a one-off announcement or event email to your studio" />

      <div className="max-w-2xl space-y-5">
        {notice && (
          <div className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${
            notice.kind === 'ok'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-700'}`}>
            {notice.kind === 'ok' ? <Check size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
            <span>{notice.text}</span>
          </div>
        )}

        <div className="bg-white rounded-lg border p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Subject <span className="text-red-500">*</span></label>
            <input value={subject} onChange={e => setSubject(e.target.value)} maxLength={200}
              placeholder="e.g. Summer recital — Saturday 12 July"
              className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Message <span className="text-red-500">*</span></label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={9} maxLength={20000}
              placeholder={'Write your announcement here.\n\nLeave a blank line between paragraphs — the email keeps your spacing and is wrapped in the Music & Life branding automatically.'}
              className="w-full border rounded px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--sage)]" />
            <p className="text-xs text-gray-400 mt-1">Plain text only. Your message is wrapped in the branded email template with the studio logo and footer.</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Send to</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(Object.keys(AUDIENCE_LABEL) as Audience[]).map(a => (
                <label key={a} className={`flex items-center justify-between gap-2 border rounded px-3 py-2 text-sm cursor-pointer ${
                  audience === a ? 'border-[var(--sage)] ring-1 ring-[var(--sage)] bg-[var(--sage)]/5' : 'hover:bg-gray-50'}`}>
                  <span className="flex items-center gap-2">
                    <input type="radio" name="audience" checked={audience === a} onChange={() => setAudience(a)} />
                    {AUDIENCE_LABEL[a]}
                  </span>
                  <span className="text-xs text-gray-400">{counts ? `${counts[a]}` : '…'}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={sendTest} disabled={!ready || testing}
            className="rounded px-4 py-2 text-sm border font-medium hover:bg-gray-50 disabled:opacity-50">
            {testing ? 'Sending…' : 'Send test to me'}
          </button>
          <button onClick={() => setConfirmOpen(true)} disabled={!ready || recipientCount === 0}
            className="inline-flex items-center gap-2 bg-[var(--sage)] text-white rounded px-4 py-2 text-sm font-medium hover:bg-[var(--sage-dk)] disabled:opacity-50">
            <Send size={15} /> Send to {AUDIENCE_LABEL[audience].split(' ')[0].toLowerCase()} ({recipientCount})
          </button>
          <span className="text-xs text-gray-400">Always send a test to yourself first.</span>
        </div>
      </div>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Send this email?">
        <p className="text-sm text-gray-600 mb-2">
          This will email <strong>{recipientCount}</strong> {recipientCount === 1 ? 'recipient' : 'recipients'} in
          the <strong>{AUDIENCE_LABEL[audience].toLowerCase()}</strong> group. This can&apos;t be undone.
        </p>
        <div className="bg-gray-50 border rounded px-3 py-2 text-sm mb-4">
          <div className="text-gray-400 text-xs mb-0.5">Subject</div>
          <div className="font-medium text-gray-800 break-words">{subject}</div>
        </div>
        <div className="flex gap-3">
          <button onClick={sendToAudience} disabled={sending}
            className="inline-flex items-center gap-2 bg-[var(--sage)] text-white rounded px-4 py-2 text-sm font-medium hover:bg-[var(--sage-dk)] disabled:opacity-50">
            <Send size={15} /> {sending ? 'Sending…' : `Yes, send to ${recipientCount}`}
          </button>
          <button onClick={() => setConfirmOpen(false)} disabled={sending}
            className="rounded px-4 py-2 text-sm border hover:bg-gray-50">Cancel</button>
        </div>
      </Modal>
    </div>
  );
}
