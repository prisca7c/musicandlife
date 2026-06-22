'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

function VerifyInner() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [status, setStatus] = useState<'pending' | 'success' | 'error'>('pending');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) { setStatus('error'); setMessage('Missing verification token.'); return; }
    apiFetch<{ message: string }>('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) })
      .then((r) => { setStatus('success'); setMessage(r.message); })
      .catch((e: Error) => { setStatus('error'); setMessage(e.message); });
  }, [token]);

  return (
    <div className="text-center space-y-4 max-w-sm">
      {status === 'pending' && <p className="text-gray-500">Verifying…</p>}
      {status === 'success' && (<><p className="text-green-700 font-medium">{message}</p><Link href="/login" className="text-[var(--sage)] hover:underline text-sm">Go to login</Link></>)}
      {status === 'error' && (<><p className="text-red-600">{message}</p><Link href="/login" className="text-[var(--sage)] hover:underline text-sm">Back to login</Link></>)}
    </div>
  );
}

export default function VerifyPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Suspense fallback={<p className="text-gray-500">Loading…</p>}>
        <VerifyInner />
      </Suspense>
    </div>
  );
}
