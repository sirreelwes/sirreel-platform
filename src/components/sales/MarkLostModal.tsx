'use client';

import { useState, useEffect } from 'react';

interface MarkLostJob {
  id: string;
  name: string;
  jobCode: string;
  company: { name: string };
}

interface MarkLostModalProps {
  job: MarkLostJob | null;
  onClose: () => void;
  onMarked: () => void;
}

const REASONS = ['Other vendor', 'Budget', 'No response', 'Timing', 'Other'] as const;

export function MarkLostModal({ job, onClose, onMarked }: MarkLostModalProps) {
  const [reason, setReason] = useState<(typeof REASONS)[number]>('Other vendor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReason('Other vendor');
    setError(null);
    setBusy(false);
  }, [job?.id]);

  if (!job) return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${job.id}/mark-lost`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed');
      }
      onMarked();
    } catch (e: any) {
      setError(e.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-zinc-800">
          <h2 className="text-base font-bold text-white">Mark as Lost</h2>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            {job.name} · {job.jobCode} · {job.company.name}
          </p>
        </div>
        <div className="p-5 space-y-3">
          <label className="block text-[11px] font-semibold text-zinc-400 uppercase tracking-wide">Reason</label>
          <div className="space-y-1.5">
            {REASONS.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm text-zinc-200 cursor-pointer">
                <input
                  type="radio"
                  name="lost-reason"
                  checked={reason === r}
                  onChange={() => setReason(r)}
                  className="accent-amber-600"
                />
                {r}
              </label>
            ))}
          </div>
          <p className="text-[11px] text-zinc-500">
            All open quotes on this job will move to Lost. Won orders are unchanged.
          </p>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-zinc-400 hover:text-white text-sm font-medium">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className={`px-4 py-2 text-white text-sm font-bold rounded-lg ${busy ? 'bg-red-700' : 'bg-red-600 hover:bg-red-500'}`}
          >
            {busy ? 'Marking…' : 'Mark Lost'}
          </button>
        </div>
      </div>
    </div>
  );
}
