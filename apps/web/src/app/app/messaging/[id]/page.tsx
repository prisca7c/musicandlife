'use client';

import { useState, useEffect, useRef, FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { useApi } from '@/lib/swr';
import { useMe } from '@/lib/use-me';
import { Paperclip, X, Download } from 'lucide-react';

interface Person { userId: string; name: string; email: string; role: string; roleLabel: string; }
interface Attachment { fileId: string; name: string; mime: string; size: number; }
interface Message {
  id: string; body: string; createdAt: string;
  senderId: string; senderName: string; senderRoleLabel: string;
  attachments?: Attachment[];
  sender: { id: string; email: string } | null;
}
interface Thread {
  id: string; subject: string; messages: Message[];
  participants: { user: { id: string; email: string } }[];
  people: Person[];
}

export default function ThreadPage() {
  const params = useParams<{ id: string }>();
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  // Photos and short videos, uploaded straight to storage before the message is
  // posted. Available to everyone in the thread — a parent sending the teacher
  // a recording of the week's practice is the whole point.
  const [pending, setPending] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  // The access token carries sub/orgId/role — it has never carried an email.
  // The old code read `email` off the JWT to decide which messages were yours,
  // so the comparison was always undefined === something: EVERY message,
  // including your own, rendered as the other person's. Compare on user id.
  const { me } = useMe();
  const myId = me?.user?.id ?? null;

  // Cached read of the thread — instant on revisit. mutate() refreshes after a
  // reply; the effect below scrolls to the newest message whenever it changes.
  const { data: thread = null, error, isLoading, mutate } = useApi<Thread>(`/threads/${params.id}`);
  const load = () => mutate();
  useEffect(() => {
    if (thread) setTimeout(() => bottomRef.current?.scrollIntoView(), 50);
  }, [thread]);

  async function pickFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true); setSendError('');
    try {
      for (const f of Array.from(files).slice(0, 10)) {
        const up = await uploadFile(f, tok(), { expiring: false });
        setPending(p => [...p, { fileId: up.fileId, name: up.name, mime: up.mime, size: up.size }]);
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function openAttachment(fileId: string) {
    try {
      const { downloadUrl } = await apiFetch<{ downloadUrl: string }>(
        `/threads/${params.id}/attachments/${fileId}`, { token: tok() });
      window.open(downloadUrl, '_blank', 'noopener');
    } catch { /* ignore — the link simply won't open */ }
  }

  async function handleReply(e: FormEvent) {
    e.preventDefault();
    // A message with only an attachment is legitimate — "here's the recording".
    if (!reply.trim() && pending.length === 0) return;
    setSending(true); setSendError('');
    try {
      await apiFetch(`/threads/${params.id}/messages`, {
        method: 'POST', token: tok(),
        body: JSON.stringify({ body: reply, attachments: pending.map(a => ({ fileId: a.fileId })) }),
      });
      setReply(''); setPending([]);
      load();
    } catch (err) {
      // A failed send used to go to console.error only: the button flickered,
      // the text stayed put and it looked like "Send doesn't work".
      setSendError(err instanceof Error ? err.message : 'Message not sent. Please try again.');
    }
    finally { setSending(false); }
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-red-600">Couldn&apos;t open this conversation.</p>
        <button onClick={() => mutate()} className="mt-3 text-sm border rounded px-3 py-1.5 hover:bg-gray-50">Try again</button>
        <div className="mt-4"><Link href="/app/messaging" className="text-sm text-gray-500 hover:text-gray-700">← Messages</Link></div>
      </div>
    );
  }
  if (!thread) return <div className="p-8 text-center text-gray-400">{isLoading ? 'Loading…' : 'Conversation not found.'}</div>;

  const others = (thread.people ?? []).filter(p => p.userId !== myId);

  // Admins can review staff↔family conversations from the oversight tab without
  // being a participant. Tell the teacher and family so it isn't a surprise —
  // their messages here aren't private from studio management. Admins already
  // know they have this access, so we don't show it to them.
  const NON_STAFF = ['guardian', 'student'];
  const people = thread.people ?? [];
  const hasFamily = people.some(p => NON_STAFF.includes(p.role));
  const hasStaff = people.some(p => p.role && !NON_STAFF.includes(p.role));
  const myRole = me?.membership?.role;
  const iAmAdmin = myRole === 'admin' || myRole === 'system_admin';
  const showOversightNotice = hasFamily && hasStaff && !iAmAdmin;

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 120px)' }}>
      <div className="mb-2"><Link href="/app/messaging" className="text-sm text-gray-500 hover:text-gray-700">← Messages</Link></div>
      <div className="bg-white rounded-lg border px-4 py-3 mb-4 shrink-0">
        {/* Who you are talking to, first and largest — so a reply meant for the
            office is never typed into a parent's thread by mistake. */}
        <h1 className="font-semibold text-gray-900">
          {others.length ? others.map(p => p.name).join(', ') : 'Just you'}
        </h1>
        <p className="text-sm text-gray-500">{thread.subject}</p>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {others.map(p => (
            <span key={p.userId} className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
              {p.name}{p.roleLabel ? ` · ${p.roleLabel}` : ''}
            </span>
          ))}
        </div>
        {showOversightNotice && (
          <p className="text-xs text-gray-400 mt-2">
            Studio admins can review this conversation. Messages here aren&apos;t private from studio management.
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pb-4">
        {thread.messages.map(msg => {
          const isMe = myId != null && msg.senderId === myId;
          return (
            <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-md rounded-2xl px-4 py-2.5 ${isMe ? 'bg-[var(--sage)] text-white' : 'bg-white border text-gray-900'}`}>
                {!isMe && (
                  <p className="text-xs font-medium mb-1 text-gray-500">
                    {msg.senderName || msg.sender?.email?.split('@')[0]}
                    {msg.senderRoleLabel ? <span className="font-normal text-gray-400"> · {msg.senderRoleLabel}</span> : null}
                  </p>
                )}
                {msg.body && <p className="text-sm whitespace-pre-wrap">{msg.body}</p>}
                {(msg.attachments ?? []).length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {(msg.attachments ?? []).map(a => (
                      <button key={a.fileId} onClick={() => openAttachment(a.fileId)}
                        className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border ${
                          isMe ? 'border-white/40 hover:bg-white/15' : 'hover:bg-gray-50'
                        }`}>
                        <Download size={12} /> <span className="truncate max-w-[160px]">{a.name}</span>
                      </button>
                    ))}
                  </div>
                )}
                <p className={`text-xs mt-1 ${isMe ? 'text-[var(--sage-md)]' : 'text-gray-400'}`}>{new Date(msg.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {sendError && <p className="shrink-0 mt-2 text-sm text-red-600">{sendError}</p>}
      {pending.length > 0 && (
        <div className="shrink-0 mt-2 flex flex-wrap gap-1.5">
          {pending.map(a => (
            <span key={a.fileId} className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 rounded-full pl-2.5 pr-1 py-0.5">
              <span className="truncate max-w-[160px]">{a.name}</span>
              <button type="button" onClick={() => setPending(p => p.filter(x => x.fileId !== a.fileId))}
                aria-label={`Remove ${a.name}`}
                className="rounded-full w-4 h-4 flex items-center justify-center hover:bg-gray-200">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <form onSubmit={handleReply} className="shrink-0 flex gap-2 bg-white border rounded-lg p-2 mt-2">
        <input ref={fileInput} type="file" multiple accept="image/*,video/*,audio/*,.pdf"
          className="hidden" onChange={e => pickFiles(e.target.files)} />
        <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading}
          title="Attach a photo, video or recording"
          className="self-end rounded-lg border px-2.5 py-2 text-gray-500 hover:bg-gray-50 disabled:opacity-50">
          <Paperclip size={15} />
        </button>
        <textarea value={reply} onChange={e => setReply(e.target.value)} placeholder="Write a reply…" rows={2}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(e); }}}
          className="flex-1 resize-none text-sm focus:outline-none px-2 py-1" />
        <button type="submit" disabled={sending || uploading || (!reply.trim() && pending.length === 0)}
          className="self-end bg-[var(--sage)] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[var(--sage-dk)] disabled:opacity-50">
          {sending ? '…' : uploading ? 'Uploading…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
