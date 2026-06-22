'use client';

import { Suspense, useState, FormEvent } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, CircleCheck } from 'lucide-react';
import { apiFetch } from '@/lib/api';

function ResetPasswordInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';

  const [stage, setStage] = useState<'request' | 'reset' | 'done'>(token ? 'reset' : 'request');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleRequest(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setLoading(true); setError('');
    const email = (new FormData(e.currentTarget)).get('email') as string;
    try {
      const r = await apiFetch<{ message: string }>('/auth/request-reset', { method: 'POST', body: JSON.stringify({ email }) });
      setMessage(r.message); setStage('done');
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }

  async function handleReset(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setLoading(true); setError('');
    const password = (new FormData(e.currentTarget)).get('password') as string;
    try {
      await apiFetch('/auth/reset', { method: 'POST', body: JSON.stringify({ token, password }) });
      router.push('/login');
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }

  return (
    <div className="auth-bg">
      <div className="auth-card">
        <div className="flex justify-center mb-7">
          <Image src="/logo-full.png" alt="Music & Life London" width={280} height={120} className="w-[220px] h-auto object-contain" priority />
        </div>

        {error && (
          <div className="mb-5 text-sm rounded-xl px-4 py-3" style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
            {error}
          </div>
        )}

        {stage === 'done' && (
          <div className="flex flex-col items-center gap-4 text-center py-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'var(--sage-lt)', border: '2px solid var(--sage-md)' }}>
              <CircleCheck size={30} color="var(--sage)" />
            </div>
            <h1 className="text-xl font-extrabold tracking-tight" style={{ color: 'var(--txt)' }}>Check your email</h1>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--txt3)' }}>{message}</p>
            <Link href="/login" className="ui-btn-primary mt-2">Back to sign in</Link>
          </div>
        )}

        {stage === 'request' && (
          <>
            <div className="mb-6">
              <h1 className="text-[22px] font-extrabold tracking-tight" style={{ color: 'var(--txt)' }}>Reset password</h1>
              <p className="text-sm mt-1" style={{ color: 'var(--txt3)' }}>Enter your email and we&apos;ll send you a reset link.</p>
            </div>
            <form onSubmit={handleRequest} className="space-y-5">
              <div>
                <label className="ui-label">Email <span style={{ color: 'var(--coral)' }}>*</span></label>
                <input name="email" type="email" required placeholder="you@example.com" className="ui-input" />
              </div>
              <button type="submit" disabled={loading} className="ui-btn-primary w-full justify-center py-3 text-[15px]" style={{ borderRadius: 12 }}>
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          </>
        )}

        {stage === 'reset' && (
          <>
            <div className="mb-6">
              <h1 className="text-[22px] font-extrabold tracking-tight" style={{ color: 'var(--txt)' }}>Set new password</h1>
              <p className="text-sm mt-1" style={{ color: 'var(--txt3)' }}>Choose a strong password of at least 8 characters.</p>
            </div>
            <form onSubmit={handleReset} className="space-y-5">
              <div>
                <label className="ui-label">New password <span style={{ color: 'var(--coral)' }}>*</span></label>
                <input name="password" type="password" required minLength={8} placeholder="Min. 8 characters" className="ui-input" />
              </div>
              <button type="submit" disabled={loading} className="ui-btn-primary w-full justify-center py-3 text-[15px]" style={{ borderRadius: 12 }}>
                {loading ? 'Resetting…' : 'Reset password'}
              </button>
            </form>
          </>
        )}

        {stage !== 'done' && (
          <Link href="/login" className="flex items-center justify-center gap-1.5 mt-6 text-sm font-semibold hover:underline" style={{ color: 'var(--sage)' }}>
            <ArrowLeft size={15} /> Back to sign in
          </Link>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="auth-bg"><div className="auth-card text-center text-sm" style={{ color: 'var(--txt3)' }}>Loading…</div></div>}>
      <ResetPasswordInner />
    </Suspense>
  );
}
