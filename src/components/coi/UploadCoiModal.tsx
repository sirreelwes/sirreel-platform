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
  // The COI the upload just created — lets the result screen approve it
  // in place (Wes 2026-09-01: "we should have the option to approve in
  // that window"). Before this the result screen offered only "Done",
  // so an agent who had just read the AI verdict still had to close,
  // find the row, and open the review modal to say yes.
  const [coiId, setCoiId] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
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
      setCoiId(typeof data.coiId === 'string' ? data.coiId : null);
      setApproved(verified);
      setResult(data.review ?? { overallPass: false, riskLevel: null, notes: null });
      setSaving(false);
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  const approveNow = async () => {
    if (!coiId || approving) return;
    setApproving(true);
    setError(null);
    try {
      const res = await fetch(`/api/coi/review/${coiId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'DECIDE',
          decision: 'APPROVED',
          note: note.trim() || 'Approved at upload after reading the AI review.',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not approve the certificate.');
        return;
      }
      setApproved(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setApproving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] supports-[max-height:85svh]:max-h-[85svh] overflow-y-auto w-full max-w-md rounded-2xl border border-zinc-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-zinc-900">Upload COI</h3>
            <p className="text-[11px] text-zinc-600">File a certificate received outside the portal</p>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-700 text-xl leading-none">×</button>
        </div>

        {result ? (
          <>
            <div className="space-y-4 px-5 py-5">
              <div className="flex items-center gap-2.5">
                <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${result.overallPass ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                  {result.overallPass ? 'AI: Passes checks' : 'AI: Needs review'}
                </span>
                {result.riskLevel && (
                  <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider ${
                    result.riskLevel === 'low' ? 'bg-emerald-100 text-emerald-700'
                      : result.riskLevel === 'high' ? 'bg-rose-100 text-rose-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}>{result.riskLevel} risk</span>
                )}
              </div>
              {result.notes && <p className="text-sm text-zinc-700 leading-relaxed">{result.notes}</p>}
              <p className="text-[11px] text-zinc-600">
                Filed on the job.{' '}
                {approved
                  ? 'Approved — the job now reads Verified and nothing further is needed.'
                  : 'Not approved yet: it sits in the review queue until someone signs off.'}{' '}
                The full breakdown is available in COI review.
              </p>
              {error && (
                <p className="text-[12px] text-rose-700">{error}</p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-4">
              {/* Approve right here, having just read the verdict above —
                  the same endpoint the review desk posts to, so there is
                  one approval path and one audit trail. */}
              {!approved && coiId && (
                <button
                  onClick={approveNow}
                  disabled={approving}
                  className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {approving ? 'Approving…' : 'Approve certificate'}
                </button>
              )}
              {approved && (
                <span className="mr-auto text-[12px] font-semibold text-emerald-700">Approved</span>
              )}
              <button
                onClick={onUploaded}
                className={`rounded-lg px-4 py-1.5 text-sm font-semibold text-white ${
                  approved ? 'bg-amber-600 hover:bg-amber-500' : 'bg-zinc-200 hover:bg-zinc-300'
                }`}
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-4 px-5 py-4">
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                  Certificate PDF
                </label>
                <FileDropzone file={file} onFile={setFile} />
              </div>

              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                  Policy expiry <span className="text-zinc-600">(optional — AI extracts it too)</span>
                </label>
                <input
                  type="date"
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
                />
              </div>

              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={verified}
                  onChange={(e) => setVerified(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-amber-600"
                />
                <span className="text-sm text-zinc-700">
                  Mark verified now (skip review queue)
                  <span className="block text-[11px] text-zinc-600">
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
                <span className="text-sm text-zinc-700">SirReel named as Additional Insured</span>
              </label>

              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                  Note <span className="text-zinc-600">(optional)</span>
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="e.g. Emailed by broker 7/18 — GL + auto confirmed"
                  className="w-full resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-600 focus:border-zinc-400 focus:outline-none"
                />
              </div>

              {error && <p className="text-sm text-rose-600">{error}</p>}
            </div>

            <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-4">
              <button
                onClick={onClose}
                disabled={saving}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-zinc-600 hover:text-zinc-900 disabled:opacity-50"
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
