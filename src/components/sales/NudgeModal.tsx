'use client';

import { useEffect, useState } from 'react';

// Compose-only nudge: prefills a follow-up subject and body, then hands the
// agent a `mailto:` link or a Copy button. No server-side send — Gmail send
// isn't wired yet (see src/lib/email.ts comments). When `followUpId` is
// supplied, "Send" also PATCHes the follow-up record so the cadence panel
// stops surfacing it.

interface NudgeJob {
  id: string;
  jobCode: string;
  name: string;
  company: { name: string };
  agent: { name: string };
  daysInStage?: number;
}

interface NudgeModalProps {
  job: NudgeJob | null;
  onClose: () => void;
  // Follow-up review mode
  followUpId?: string | null;
  initialTo?: string;
  initialSubject?: string;
  initialBody?: string;
  stageLabel?: string;
  onSent?: () => void;
  onSkipped?: () => void;
}

function defaultBody(job: NudgeJob) {
  const days = job.daysInStage != null ? `${job.daysInStage} day${job.daysInStage === 1 ? '' : 's'}` : 'a few days';
  return [
    `Hi,`,
    ``,
    `Just circling back on the SirReel quote we sent ${days} ago for ${job.name} (${job.jobCode}).`,
    ``,
    `Let me know if I can provide any more information or modify the quote to get this done — happy to adjust line items, dates, or pricing if it helps.`,
    ``,
    `Thanks,`,
    `${job.agent.name}`,
    `SirReel Production Vehicles`,
  ].join('\n');
}

function defaultSubject(job: NudgeJob) {
  return `Following up — ${job.name} (${job.jobCode})`;
}

export function NudgeModal({
  job,
  onClose,
  followUpId = null,
  initialTo,
  initialSubject,
  initialBody,
  stageLabel,
  onSent,
  onSkipped,
}: NudgeModalProps) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [copied, setCopied] = useState<'subject' | 'body' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!job) return;
    setTo(initialTo || '');
    setSubject(initialSubject || defaultSubject(job));
    setBody(initialBody || defaultBody(job));
    setCopied(null);
    setError(null);
  }, [job, initialTo, initialSubject, initialBody]);

  if (!job) return null;

  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  const copy = async (which: 'subject' | 'body') => {
    const text = which === 'subject' ? subject : body;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard unavailable — fields are editable so user can copy manually */
    }
  };

  const markSent = async () => {
    if (!followUpId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sales/follow-ups/${followUpId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', subject, body }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to mark sent');
      }
      onSent?.();
    } catch (e: any) {
      setError(e.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    if (!followUpId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sales/follow-ups/${followUpId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'skip' }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to skip');
      }
      onSkipped?.();
    } catch (e: any) {
      setError(e.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const isFollowUp = !!followUpId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white">
              {isFollowUp ? 'Follow-up' : 'Nudge'} — {job.company.name}
            </h2>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              {job.name} · {job.jobCode}
              {stageLabel && <> · <span className="text-amber-400">{stageLabel}</span></>}
              {!stageLabel && job.daysInStage != null && <> · {job.daysInStage} day{job.daysInStage === 1 ? '' : 's'} in stage</>}
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-zinc-400 uppercase tracking-wide mb-1">To</label>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="client@example.com"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-semibold text-zinc-400 uppercase tracking-wide">Subject</label>
              <button onClick={() => copy('subject')} className="text-[10px] text-zinc-500 hover:text-zinc-300">
                {copied === 'subject' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-semibold text-zinc-400 uppercase tracking-wide">Body</label>
              <button onClick={() => copy('body')} className="text-[10px] text-zinc-500 hover:text-zinc-300">
                {copied === 'body' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white font-mono"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-end gap-2 flex-wrap">
          {isFollowUp && (
            <button
              onClick={skip}
              disabled={busy}
              className="px-3 py-2 text-zinc-400 hover:text-white disabled:opacity-50 text-sm font-medium"
            >
              Skip
            </button>
          )}
          <button onClick={onClose} className="px-3 py-2 text-zinc-400 hover:text-white text-sm font-medium">
            Cancel
          </button>
          <a
            href={mailto}
            onClick={isFollowUp ? () => { void markSent(); } : undefined}
            className={`px-4 py-2 text-white text-sm font-bold rounded-lg ${busy ? 'bg-amber-700' : 'bg-amber-600 hover:bg-amber-500'}`}
          >
            {isFollowUp ? 'Send & open mail' : 'Open in mail app'}
          </a>
        </div>
      </div>
    </div>
  );
}
