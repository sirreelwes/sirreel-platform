'use client';

import { useState } from 'react';
import { FileDropzone } from '@/components/ui/FileDropzone';

/**
 * Internal COI attach modal — the backfill/offline path. An agent files a
 * signed Certificate of Insurance that arrived outside the portal (email,
 * broker, RentalWorks) against an HQ job. On success the parent reloads so
 * the COI status flips. POSTs multipart to /api/jobs/[id]/coi.
 */
export function UploadCoiModal({
  jobId,
  onClose,
  onUploaded,
}: {
  jobId: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [expiry, setExpiry] = useState('');
  const [verified, setVerified] = useState(false);
  const [additionalInsured, setAdditionalInsured] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ overallPass: boolean; riskLevel: string | null; notes: string | null } | null>(null);

  const submit = async () => {
    if (!file) {
      setError('Choose a PDF to upload.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('coverageVerified', verified ? 'true' : 'false');
      fd.append('additionalInsured', additionalInsured ? 'true' : 'false');
      if (expiry) fd.append('policyExpiryDate', expiry);
      if (note.trim()) fd.append('note', note.trim());
      const res = await fetch(`/api/jobs/${jobId}/coi`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Upload failed.');
        setSaving(false);
        return;
      }
      // Show the AI review result before returning to the page.
      setResult(data.review ?? { overallPass: false, riskLevel: null, notes: null });
      setSaving(false);
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-white">Upload COI</h3>
            <p className="text-[11px] text-zinc-500">File a certificate received outside the portal</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">×</button>
        </div>

        {result ? (
          <>
            <div className="space-y-4 px-5 py-5">
              <div className="flex items-center gap-2.5">
                <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${result.overallPass ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                  {result.overallPass ? 'AI: Passes checks' : 'AI: Needs review'}
                </span>
                {result.riskLevel && (
                  <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider ${
                    result.riskLevel === 'low' ? 'bg-emerald-500/15 text-emerald-300'
                      : result.riskLevel === 'high' ? 'bg-rose-500/15 text-rose-300'
                      : 'bg-amber-500/15 text-amber-300'
                  }`}>{result.riskLevel} risk</span>
                )}
              </div>
              {result.notes && <p className="text-sm text-zinc-300 leading-relaxed">{result.notes}</p>}
              <p className="text-[11px] text-zinc-500">
                Filed on the job. {verified ? 'Marked verified.' : 'Left in the review queue for a human decision.'} The full
                breakdown is available in COI review.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-4">
              <button
                onClick={onUploaded}
                className="rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-500"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-4 px-5 py-4">
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  Certificate PDF
                </label>
                <FileDropzone file={file} onFile={setFile} />
              </div>

              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  Policy expiry <span className="text-zinc-600">(optional — AI extracts it too)</span>
                </label>
                <input
                  type="date"
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white focus:border-zinc-500 focus:outline-none"
                />
              </div>

              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={verified}
                  onChange={(e) => setVerified(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-amber-600"
                />
                <span className="text-sm text-zinc-300">
                  Mark verified now (skip review queue)
                  <span className="block text-[11px] text-zinc-500">
                    Leave unchecked to file it and let the AI review + a human decision run, just like COI review. Check only to sign off immediately.
                  </span>
                </span>
              </label>

              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={additionalInsured}
                  onChange={(e) => setAdditionalInsured(e.target.checked)}
                  className="h-4 w-4 accent-amber-600"
                />
                <span className="text-sm text-zinc-300">SirReel named as Additional Insured</span>
              </label>

              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  Note <span className="text-zinc-600">(optional)</span>
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="e.g. Emailed by broker 7/18 — GL + auto confirmed"
                  className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
                />
              </div>

              {error && <p className="text-sm text-rose-400">{error}</p>}
            </div>

            <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-4">
              <button
                onClick={onClose}
                disabled={saving}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={saving}
                className="rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
              >
                {saving ? 'Reviewing…' : 'Upload & review'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
