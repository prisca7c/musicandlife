'use client';

import { useState, useEffect, FormEvent } from 'react';
import { apiFetch } from '@/lib/api';
import { Music, Mail, CheckCircle2 } from 'lucide-react';

interface Terms { studioName: string; price: number; months: number; }

export default function LibrarySubscribePage() {
  const [terms, setTerms] = useState<Terms | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<'pending' | 'active' | null>(null);

  useEffect(() => {
    apiFetch<Terms>('/public/library/terms')
      .then(setTerms)
      .catch(() => setTerms(null));
  }, []);

  const money = (p: number) => `£${(p / 100).toFixed(2)}`;
  const period = (m: number) => (m === 1 ? 'month' : `${m} months`);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      const res = await apiFetch<{ status: 'pending' | 'active' }>('/public/library/subscribe', {
        method: 'POST',
        body: JSON.stringify({ email, name: name || undefined }),
      });
      setDone(res.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-md mx-auto">
        <div className="bg-white rounded-xl border shadow-sm p-8">
          <div className="flex items-center gap-2 mb-1 text-[var(--sage-dk)]">
            <Music size={20} />
            <span className="text-sm font-semibold">{terms?.studioName ?? 'Music & Life'}</span>
          </div>

          {done ? (
            <div className="mt-4">
              <CheckCircle2 size={40} className="text-green-600 mb-3" />
              {done === 'active' ? (
                <>
                  <h1 className="text-xl font-bold text-gray-900 mb-1">You already have access</h1>
                  <p className="text-sm text-gray-600">This email is already an active subscriber. Check your inbox for your library link, or ask the studio to resend it.</p>
                </>
              ) : (
                <>
                  <h1 className="text-xl font-bold text-gray-900 mb-1">Thanks — you’re on the list</h1>
                  <p className="text-sm text-gray-600">
                    We’ve noted your request for <span className="font-medium">{email}</span>. Once your payment is confirmed
                    we’ll email you a personal link that opens the library — no account or password needed.
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Resource library access</h1>
              <p className="text-sm text-gray-600 mb-5">
                Sheet music, practice tracks and teaching videos you can use at home. No account needed — you get a
                private link to the library, and it stays open while your subscription is active.
              </p>

              {terms && (
                <div className="rounded-lg bg-[var(--sage-lt)] border border-[var(--sage)]/30 p-4 mb-5">
                  <p className="text-xs uppercase tracking-wide text-[var(--sage-dk)] mb-1">Subscription</p>
                  <p className="text-2xl font-bold text-gray-900">{money(terms.price)}
                    <span className="text-sm font-normal text-gray-500"> / {period(terms.months)}</span>
                  </p>
                </div>
              )}

              {error && <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

              <form onSubmit={submit} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Your name <span className="text-gray-400 font-normal">(optional)</span></label>
                  <input value={name} onChange={e => setName(e.target.value)}
                    className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Email <span className="text-red-500">*</span></label>
                  <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]" />
                </div>
                <button type="submit" disabled={submitting}
                  className="w-full flex items-center justify-center gap-2 bg-[var(--sage)] text-white rounded px-4 py-2.5 text-sm font-medium hover:bg-[var(--sage-dk)] disabled:opacity-50">
                  <Mail size={15} />
                  {submitting ? 'Sending…' : 'Request access'}
                </button>
              </form>
              <p className="text-xs text-gray-400 mt-4">
                After you request access the studio confirms your payment and emails your library link.
                You can cancel any time and access stops at the end of the paid period.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
