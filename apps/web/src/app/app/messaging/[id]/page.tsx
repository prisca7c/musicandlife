'use client';

import { useState, useEffect, useRef, FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';

interface Message { id: string; body: string; createdAt: string; sender: { id: string; email: string } | null; }
interface Thread { id: string; subject: string; messages: Message[]; participants: { user: { id: string; email: string } }[]; }

export default function ThreadPage() {
  const params = useParams<{ id: string }>();
  const [thread, setThread] = useState<Thread | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];
  const myEmail = document.cookie.match(/access_token=([^;]+)/)?.[1]
    ? (() => { try { return JSON.parse(atob((document.cookie.match(/access_token=([^;]+)/)?.[1]??'').split('.')[1]??''))?.email; } catch { return ''; } })()
    : '';

  function load() { apiFetch<Thread>(`/threads/${params.id}`, { token: tok() }).then(t => { setThread(t); setTimeout(() => bottomRef.current?.scrollIntoView(), 50); }).catch(() => {}); }
  useEffect(() => { load(); }, [params.id]);

  async function handleReply(e: FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    try {
      await apiFetch(`/threads/${params.id}/messages`, { method: 'POST', token: tok(), body: JSON.stringify({ body: reply }) });
      setReply('');
      load();
    } catch (e) { console.error(e); }
    finally { setSending(false); }
  }

  if (!thread) return <div className="p-8 text-center text-gray-400">Loading…</div>;

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 120px)' }}>
      <div className="mb-2"><Link href="/app/messaging" className="text-sm text-gray-500 hover:text-gray-700">← Messages</Link></div>
      <div className="bg-white rounded-lg border px-4 py-3 mb-4 shrink-0">
        <h1 className="font-semibold text-gray-900">{thread.subject}</h1>
        <div className="flex gap-1 mt-1">
          {thread.participants.map(p => (
            <span key={p.user.id} className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">{p.user.email.split('@')[0]}</span>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pb-4">
        {thread.messages.map(msg => {
          const isMe = msg.sender?.email === myEmail;
          return (
            <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-md rounded-2xl px-4 py-2.5 ${isMe ? 'bg-[var(--sage)] text-white' : 'bg-white border text-gray-900'}`}>
                {!isMe && <p className="text-xs font-medium mb-1 text-gray-500">{msg.sender?.email.split('@')[0]}</p>}
                <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                <p className={`text-xs mt-1 ${isMe ? 'text-[var(--sage-md)]' : 'text-gray-400'}`}>{new Date(msg.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleReply} className="shrink-0 flex gap-2 bg-white border rounded-lg p-2 mt-2">
        <textarea value={reply} onChange={e => setReply(e.target.value)} placeholder="Write a reply…" rows={2}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(e); }}}
          className="flex-1 resize-none text-sm focus:outline-none px-2 py-1" />
        <button type="submit" disabled={sending || !reply.trim()}
          className="self-end bg-[var(--sage)] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[var(--sage-dk)] disabled:opacity-50">
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
