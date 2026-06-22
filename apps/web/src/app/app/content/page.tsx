'use client';

import { useState, useEffect, FormEvent } from 'react';
import { apiFetch } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/badge';
import { Modal } from '@/components/modal';

interface Lesson { id: string; startsAt: string; student: { firstName: string; lastName: string } | null; }
interface AiData {
  recording: { id: string; status: string; mediaType: string; consent: boolean } | null;
  jobs: { id: string; kind: string; status: string; createdAt: string }[];
}

function UploadRecordingModal({ open, onClose, lessonId, onCreated }: { open: boolean; onClose: () => void; lessonId: string; onCreated: () => void }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    const consent = f.get('consent') === 'on';
    if (!consent) { setError('Consent is required before uploading a recording.'); setSaving(false); return; }
    try {
      await apiFetch(`/lessons/${lessonId}/recordings`, { method: 'POST', token: tok(), body: JSON.stringify({
        mediaType: f.get('mediaType'), consent: true, mime: 'audio/mpeg', size: 1024, originalName: 'recording',
      })});
      onCreated(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Attach recording">
      {error && <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div><label className="block text-sm font-medium mb-1">Media type</label>
          <select name="mediaType" className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sage)]">
            <option value="audio">Audio</option>
            <option value="video">Video</option>
          </select></div>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" name="consent" className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[var(--sage)]" />
          <span className="text-sm text-gray-700">I confirm the student and/or guardian has consented to this recording being processed for AI summary (UK GDPR)</span>
        </label>
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving} className="bg-[var(--sage)] text-white rounded px-4 py-2 text-sm font-medium hover:bg-[var(--sage-dk)] disabled:opacity-50">{saving ? 'Uploading…' : 'Upload & trigger AI'}</button>
          <button type="button" onClick={onClose} className="rounded px-4 py-2 text-sm border hover:bg-gray-50">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

function AiTab() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [aiData, setAiData] = useState<AiData | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  const mon = new Date();
  mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));

  useEffect(() => {
    apiFetch<Lesson[]>(`/lessons?weekStart=${mon.toISOString().split('T')[0]}`, { token: tok() })
      .then(l => setLessons(l.filter(x => x.student))).catch(() => {});
  }, []);

  function selectLesson(id: string) {
    setSelected(id); setAiData(null);
    apiFetch<AiData>(`/lessons/${id}/ai`, { token: tok() }).then(setAiData).catch(() => {});
  }

  async function triggerSummary() {
    if (!selected || !aiData?.recording) return;
    await apiFetch(`/lessons/${selected}/recordings/${aiData.recording.id}/summary`, { method: 'POST', token: tok() });
    apiFetch<AiData>(`/lessons/${selected}/ai`, { token: tok() }).then(setAiData);
  }

  return (
    <div>
      <UploadRecordingModal open={showUpload} onClose={() => setShowUpload(false)} lessonId={selected ?? ''} onCreated={() => selectLesson(selected!)} />
      <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-6">
        Running stub providers. Set AI_TRANSCRIPTION_PROVIDER=whisper and AI_SUMMARY_PROVIDER=llm in .env to enable real AI.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="px-4 py-3 border-b"><h2 className="font-semibold text-gray-700 text-sm">This week's lessons</h2></div>
          <div className="divide-y">
            {lessons.length === 0 && <p className="px-4 py-6 text-sm text-gray-400">No lessons this week.</p>}
            {lessons.map(l => (
              <button key={l.id} onClick={() => selectLesson(l.id)}
                className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-50 ${selected === l.id ? 'bg-[var(--sage-lt)] border-l-2 border-[var(--sage)]' : ''}`}>
                <p className="font-medium">{l.student?.firstName} {l.student?.lastName}</p>
                <p className="text-xs text-gray-400">{new Date(l.startsAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</p>
              </button>
            ))}
          </div>
        </div>
        <div className="lg:col-span-2">
          {!selected ? (
            <div className="bg-white rounded-xl border px-4 py-12 text-center text-gray-400">Select a lesson to view or generate an AI summary.</div>
          ) : (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold text-gray-700">Recording</h2>
                  {!aiData?.recording && (
                    <button onClick={() => setShowUpload(true)} className="text-sm bg-[var(--sage)] text-white rounded px-3 py-1.5 hover:bg-[var(--sage-dk)]">Attach recording</button>
                  )}
                </div>
                {!aiData ? <p className="text-sm text-gray-400">Loading…</p> :
                  !aiData.recording ? <p className="text-sm text-gray-500">No recording attached. Attach audio/video to trigger the AI pipeline.</p> : (
                    <div className="text-sm space-y-1">
                      <div className="flex gap-2 items-center">
                        <Badge variant={aiData.recording.status}>{aiData.recording.status}</Badge>
                        <span className="text-gray-600 capitalize">{aiData.recording.mediaType}</span>
                        {aiData.recording.consent && <span className="text-xs text-green-600">✓ consent given</span>}
                      </div>
                      {aiData.recording.status === 'uploaded' && (
                        <button onClick={triggerSummary} className="mt-3 bg-[var(--sage)] text-white rounded px-4 py-2 text-sm font-medium hover:bg-[var(--sage-dk)]">
                          Generate AI summary
                        </button>
                      )}
                    </div>
                  )
                }
              </div>
              {aiData?.jobs && aiData.jobs.length > 0 && (
                <div className="bg-white rounded-xl border p-5">
                  <h2 className="font-semibold text-gray-700 mb-3">Pipeline jobs</h2>
                  <div className="space-y-2">
                    {aiData.jobs.map(j => (
                      <div key={j.id} className="flex items-center justify-between text-sm">
                        <span className="capitalize text-gray-700">{j.kind}</span>
                        <Badge variant={j.status === 'succeeded' ? 'active' : j.status === 'failed' ? 'withdrawn' : 'trial'}>{j.status}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RepertoireTab() {
  return (
    <div className="bg-white rounded-xl border px-5 py-12 text-center">
      <p className="text-gray-500 font-medium mb-2">Repertoire management</p>
      <p className="text-sm text-gray-400 max-w-sm mx-auto">
        The repertoire module is scaffolded in the database (repertoire_pieces + practice_logs tables).
        The full CRUD UI is the next sprint iteration. For now, piece assignments can be created via the API directly.
      </p>
      <p className="text-xs text-gray-300 mt-4">POST /repertoire-pieces · GET /students/:id/repertoire</p>
    </div>
  );
}

export default function ContentPage() {
  const [tab, setTab] = useState<'ai' | 'repertoire'>('ai');

  return (
    <div>
      <PageHeader title="Content" subtitle={tab === 'ai' ? 'Attach a recording to generate a lesson summary' : 'Assign and track pieces for your students'} />

      <div className="flex gap-1 mb-5 border-b">
        {([['ai', 'AI Summaries'], ['repertoire', 'Repertoire & LMS']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === key ? 'border-[var(--sage)] text-[var(--sage)]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'ai' && <AiTab />}
      {tab === 'repertoire' && <RepertoireTab />}
    </div>
  );
}
