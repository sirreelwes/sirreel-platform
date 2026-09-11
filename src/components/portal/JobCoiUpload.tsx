'use client';

/**
 * The job portal's COI dropzone + submit, as one piece so the Certificate of
 * Insurance row can render it in BOTH states: before anything is on file,
 * and — Wes 2026-09-11, "Upload a COI for your teams… add it to the job
 * portal too" — after one is. It used to exist only in the first, so a
 * client holding a renewal, a corrected certificate, or a show-specific
 * policy had nowhere to put it once any certificate stood on the job.
 *
 * Presentational: the page owns the file/uploading/error state and the POST
 * to /api/portal/job/coi, which is unchanged.
 */

import { FileText, Send } from 'lucide-react';

export function JobCoiUpload({
  file,
  uploading,
  error,
  onFile,
  onSubmit,
}: {
  file: File | null;
  uploading: boolean;
  error: string;
  onFile: (file: File | null) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-2">
      <label
        htmlFor="portal-coi-file"
        className={`block border-2 border-dashed rounded-xl p-4 text-center cursor-pointer ${
          file ? 'border-amber-300 bg-amber-50' : 'border-zinc-200 hover:border-zinc-300 bg-zinc-50'
        }`}
      >
        {file ? (
          <>
            <div className="text-xl"><FileText size={20} aria-hidden /></div>
            <div className="text-xs font-semibold text-amber-700">{file.name}</div>
            <div className="text-[10px] text-zinc-400 mt-0.5">{(file.size / 1024).toFixed(0)} KB</div>
          </>
        ) : (
          <>
            <div className="text-xl"><Send size={20} aria-hidden /></div>
            <div className="text-xs text-zinc-500">Click to upload your COI</div>
            <div className="text-[10px] text-zinc-400 mt-0.5">PDF, PNG, or JPG · max 10 MB</div>
          </>
        )}
        <input
          id="portal-coi-file"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0] || null)}
        />
      </label>
      {error && <div className="text-[11px] text-red-600">{error}</div>}
      <button
        onClick={onSubmit}
        disabled={!file || uploading}
        className="w-full py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-200 disabled:text-zinc-400 text-white text-xs font-semibold rounded-xl"
      >
        {uploading ? 'Uploading & reviewing…' : 'Submit COI'}
      </button>
    </div>
  );
}
