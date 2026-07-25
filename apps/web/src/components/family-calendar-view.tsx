'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { CalendarPlus, Copy, Check, RefreshCw, Smartphone, ShieldAlert } from 'lucide-react';

/**
 * The subscribe screen a family sees. Kept free of data fetching so the page
 * can wire it to the API and a local preview can render it with sample values.
 */
export function FamilyCalendarView({
  url,
  onRegenerate,
}: {
  url: string;
  onRegenerate: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);

  // webcal:// makes phones hand the link straight to the calendar app rather
  // than downloading a one-off file that never updates again.
  const webcal = url.replace(/^https?:\/\//, 'webcal://');

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function regenerate() {
    setRegenerating(true);
    try {
      await onRegenerate();
      setConfirmingReset(false);
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Add lessons to your calendar"
        subtitle="Your lessons appear in your phone's calendar and update automatically"
      />

      <div className="max-w-2xl space-y-5">
        <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
          <div className="flex items-start gap-3 mb-4">
            <div className="rounded-xl p-2.5 shrink-0" style={{ background: 'var(--sage-lt)' }}>
              <CalendarPlus size={20} style={{ color: 'var(--sage)' }} />
            </div>
            <div>
              <p className="font-bold text-[15px]">Subscribe once, and you&apos;re done</p>
              <p className="text-[13px] mt-0.5" style={{ color: 'var(--txt3)' }}>
                Your phone reminds you before each lesson — you choose how far ahead. If a lesson
                is moved or cancelled, your calendar updates on its own.
              </p>
            </div>
          </div>

          <a
            href={webcal}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white"
            style={{ background: 'var(--sage)' }}
          >
            <Smartphone size={16} /> Add to my calendar
          </a>

          <div className="mt-5">
            <label className="block text-[11px] uppercase tracking-wider font-bold mb-1.5" style={{ color: 'var(--txt3)' }}>
              Or copy the link
            </label>
            <div className="flex gap-2">
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 px-3 py-2 rounded-xl border text-[12px] font-mono bg-[var(--surf)]"
                style={{ borderColor: 'var(--bd2)', color: 'var(--txt3)' }}
              />
              <button
                type="button"
                onClick={copy}
                disabled={!url}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-semibold disabled:opacity-50"
                style={{ borderColor: 'var(--bd2)' }}
              >
                {copied ? <Check size={15} style={{ color: 'var(--sage)' }} /> : <Copy size={15} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--bd)' }}>
          <p className="font-bold text-sm mb-3">How to add it</p>
          <dl className="space-y-3 text-[13px]">
            <div>
              <dt className="font-semibold">iPhone &amp; iPad</dt>
              <dd style={{ color: 'var(--txt3)' }}>
                Tap <strong>Add to my calendar</strong> above and confirm. Or: Settings → Calendar →
                Accounts → Add Account → Other → Add Subscribed Calendar, and paste the link.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Google Calendar</dt>
              <dd style={{ color: 'var(--txt3)' }}>
                On a computer, open Google Calendar → next to <em>Other calendars</em> click{' '}
                <strong>+</strong> → <strong>From URL</strong>, and paste the link.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Outlook</dt>
              <dd style={{ color: 'var(--txt3)' }}>
                Add calendar → Subscribe from web, and paste the link.
              </dd>
            </div>
          </dl>
          <p className="text-[12px] mt-4 pt-3 border-t" style={{ color: 'var(--txt4)', borderColor: 'var(--bd)' }}>
            Calendars refresh on their own schedule — usually within a few hours, not instantly.
          </p>
        </div>

        <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--bd)', background: 'var(--surf)' }}>
          <div className="flex items-start gap-2.5">
            <ShieldAlert size={17} className="shrink-0 mt-0.5" style={{ color: 'var(--txt3)' }} />
            <div className="flex-1">
              <p className="font-bold text-sm">Keep this link private</p>
              <p className="text-[13px] mt-0.5" style={{ color: 'var(--txt3)' }}>
                Anyone with the link can see your lesson times (nothing else — no invoices, notes or
                payment details). If you&apos;ve shared it by accident, reset it and the old link stops working.
              </p>

              {!confirmingReset ? (
                <button
                  type="button"
                  onClick={() => setConfirmingReset(true)}
                  className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold underline"
                  style={{ color: 'var(--txt3)' }}
                >
                  <RefreshCw size={13} /> Reset my link
                </button>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold">
                    Reset it? You&apos;ll need to re-add the calendar on each device.
                  </span>
                  <button
                    type="button"
                    onClick={regenerate}
                    disabled={regenerating}
                    className="px-3 py-1.5 rounded-lg text-[13px] font-bold text-white disabled:opacity-50"
                    style={{ background: 'var(--coral)' }}
                  >
                    {regenerating ? 'Resetting…' : 'Yes, reset'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingReset(false)}
                    disabled={regenerating}
                    className="px-3 py-1.5 rounded-lg text-[13px] font-semibold border"
                    style={{ borderColor: 'var(--bd2)' }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
