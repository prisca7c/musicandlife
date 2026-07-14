'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Eye, EyeOff } from 'lucide-react';
import { apiFetch } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const email = form.get('email') as string;
    const password = form.get('password') as string;

    try {
      const { accessToken } = await apiFetch<{ accessToken: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      // 30-day cookie (matches the refresh-token lifetime) with SameSite=Lax so
      // the session survives closing the tab and following links in from email.
      // The token inside still expires in ~15 min; apiFetch refreshes it silently.
      document.cookie = `access_token=${accessToken}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
      router.push('/app/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-bg">
      <div className="auth-card">

        {/* Logo */}
        <div className="flex justify-center mb-7">
          <Image src="/logo-full.png" alt="Music & Life London"
            width={280} height={120}
            className="w-[220px] h-auto object-contain" priority />
        </div>

        {/* Heading */}
        <div className="mb-6">
          <h1 className="text-[22px] font-extrabold tracking-tight" style={{ color: 'var(--txt)' }}>
            Sign in
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--txt3)' }}>
            Welcome back to your studio portal
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 mb-5 text-sm rounded-xl px-4 py-3"
            style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Email */}
          <div>
            <label htmlFor="email" className="ui-label">
              Email <span style={{ color: 'var(--coral)' }}>*</span>
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              className="ui-input"
            />
          </div>

          {/* Password */}
          <div>
            <label htmlFor="password" className="ui-label">
              Password <span style={{ color: 'var(--coral)' }}>*</span>
            </label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPw ? 'text' : 'password'}
                autoComplete="current-password"
                required
                placeholder="Your password"
                className="ui-input pr-10"
              />
              <button type="button" onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                style={{ color: 'var(--txt4)' }}
                tabIndex={-1}>
                {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            <div className="flex justify-end mt-1.5">
              <Link href="/reset-password"
                className="text-xs font-semibold hover:underline"
                style={{ color: 'var(--sage)' }}>
                Forgot password?
              </Link>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="ui-btn-primary w-full justify-center py-3 text-[15px] rounded-xl mt-1"
            style={{ borderRadius: 12 }}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-sm mt-6" style={{ color: 'var(--txt3)' }}>
          New student?{' '}
          <Link href="/register"
            className="font-semibold hover:underline"
            style={{ color: 'var(--sage)' }}>
            Register here
          </Link>
        </p>
      </div>
    </div>
  );
}
