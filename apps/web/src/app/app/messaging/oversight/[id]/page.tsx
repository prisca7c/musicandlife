'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useApi } from '@/lib/swr';
import { Eye } from 'lucide-react';

interface Person { userId: string; name: string; email: string; role: string; roleLabel: string; }
interface Message {
  id: string; body: string; createdAt: string;
  senderId: string; senderName: string; senderRoleLabel: string;
}
interface OversightThread {
  id: string; subject: string; createdAt: string; updatedAt: string;
  people: Person[]; messages: Message[];
}

const NON_STAFF = ['guardian', 'student'];

/**
 * Admin review of a staff↔family conversation the admin isn't part of.
 *
 * Deliberately NOT the normal thread view: there is no reply box, nothing is
 * marked read (a parent shouldn't see "read" because an admin audited the
 * thread), and the layout is a plain transcript rather than chat bubbles —
 * neither side is "you" here, so left/right alignment would be meaningless.
 */
export default function OversightThreadPage() {
  const params = useParams<{ id: string }>();
  const { data: thread = null, error, isLoading, mutate } = useApi<OversightThread>(`/threads/oversight/${params.id}`);

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

  const staff = thread.people.filter(p => p.role && !NON_STAFF.includes(p.role));
  const family = thread.people.filter(p => NON_STAFF.includes(p.role));

  return (
    <div>
      <div className="mb-2"><Link href="/app/messaging" className="text-sm text-gray-500 hover:text-gray-700">← Messages</Link></div>

      <div className="bg-white rounded-lg border px-4 py-3 mb-3">
        <h1 className="font-semibold text-gray-900">
          {staff.map(p => p.name).join(', ')} <span className="text-gray-400">↔</span> {family.map(p => p.name).join(', ')}
        </h1>
        <p className="text-sm text-gray-500">{thread.subject}</p>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {thread.people.map(p => (
            <span key={p.userId} className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
              {p.name}{p.roleLabel ? ` · ${p.roleLabel}` : ''}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-sm mb-3"
        style={{ borderColor: 'var(--bd2)', background: 'var(--surf)' }}>
        <Eye size={15} className="mt-0.5 shrink-0 text-gray-500" />
        <p className="text-gray-600">
          You are reviewing a conversation you are not part of. It stays unread for the people in it, and you can&apos;t reply here.
        </p>
      </div>

      <div className="bg-white rounded-lg border divide-y">
        {thread.messages.length === 0 && (
          <p className="px-4 py-10 text-center text-gray-400 text-sm">No messages in this conversation.</p>
        )}
        {thread.messages.map(m => (
          <div key={m.id} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium text-gray-800">
                {m.senderName}
                {m.senderRoleLabel && <span className="font-normal text-gray-400"> · {m.senderRoleLabel}</span>}
              </p>
              <span className="text-xs text-gray-400 shrink-0">
                {new Date(m.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <p className="text-sm text-gray-700 whitespace-pre-wrap mt-1">{m.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
