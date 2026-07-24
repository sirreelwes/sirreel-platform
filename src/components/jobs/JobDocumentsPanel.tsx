'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileDropzone } from '@/components/ui/FileDropzone';

/**
 * Transitional RentalWorks document panel on the Job page.
 *
 * RW's API has no print/PDF endpoint and its quote browse is broken, so
 * quotes/invoices can't be pulled programmatically. Until quoting is
 * native, staff export the PDF from RW and attach it here — HQ becomes the
 * one place to FIND the document while RW stays the system of record.
 */

type JobDoc = {
  id: string;
  kind: 'QUOTE' | 'INVOICE' | 'OTHER';
  source: string;
  refNumber: string | null;
  amount: number | null;
  documentDate: string | null;
  originalFilename: string;
  fileSize: number;
  note: string | null;
  createdAt: string;
  uploadedBy: { id: string; name: string } | null;
};

const KIND_CHIP: Record<JobDoc['kind'], string> = {
  QUOTE: 'bg-blue-950/40 text-blue-300 border-blue-900',
  INVOICE: 'bg-emerald-950/40 text-emerald-300 border-emerald-900',
  OTHER: 'bg-zinc-800 text-zinc-300 border-zinc-700',
};

function fmtDate(d: string | null) {
  if (!d) return null;
  const dt = new Date(d);
  return isNaN(dt.getTime())
    ? null
    : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function JobDocumentsPanel({ jobId }: { jobId: string }) {
  const [docs, setDocs] = useState<JobDoc[] | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/jobs/${jobId}/documents`);
    if (!r.ok) { setDocs([]); return; }
    const d = await r.json();
    setDocs(d.documents || []);
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  const remove = async (id: string) => {
    if (!window.confirm('Remove this document from the job?')) return;
    await fetch(`/api/jobs/documents/${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <div className="bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-700/70">
      <div className="flex items-center justify-between mb-2.5 gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h2 className="text-[15px] font-semibold text-white flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">
            Quotes &amp; Invoices
          </h2>
          <span className="text-[12px] text-zinc-300">from RentalWorks</span>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="text-[13px] font-semibold bg-zinc-800 hover:bg-zinc-700 text-amber-300 px-3 py-1.5 rounded-lg transition-colors"
        >
          + Attach document
        </button>
      </div>

      {docs === null ? (
        <div className="text-[13px] text-zinc-400">Loading…</div>
      ) : docs.length === 0 ? (
        <div className="text-[14px] text-zinc-300 border border-dashed border-zinc-800 rounded-xl px-4 py-4 text-center bg-zinc-950/40">
          No quotes or invoices attached yet. Export the PDF from RentalWorks and attach it here so
          it lives with the job.
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => (
            <div
              key={d.id}
              className="flex items-center gap-3 flex-wrap rounded-xl border border-zinc-800 bg-zinc-950/60 px-3.5 py-2.5"
            >
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${KIND_CHIP[d.kind]}`}>
                {d.kind}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {d.refNumber && <span className="text-[14px] text-white font-mono">#{d.refNumber}</span>}
                  <span className="text-[13px] text-zinc-300 truncate">{d.originalFilename}</span>
                  {d.amount != null && (
                    <span className="text-[13px] text-zinc-100 font-semibold">
                      ${d.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  )}
                </div>
                <div className="text-[12px] text-zinc-400">
                  {fmtDate(d.documentDate) && <>dated {fmtDate(d.documentDate)} · </>}
                  {d.source === 'RENTALWORKS' ? 'RentalWorks' : d.source} · attached{' '}
                  {fmtDate(d.createdAt)}
                  {d.uploadedBy && <> by {d.uploadedBy.name}</>}
                  {d.note && <> · {d.note}</>}
                </div>
              </div>
              <a
                href={`/api/jobs/documents/${d.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] font-semibold text-amber-400 hover:text-amber-300 shrink-0"
              >
                View PDF →
              </a>
              <button
                onClick={() => remove(d.id)}
                className="text-[12px] text-zinc-400 hover:text-rose-400 shrink-0"
                title="Remove from job"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {open && (
        <AttachModal
          jobId={jobId}
          onClose={() => setOpen(false)}
          onUploaded={() => { setOpen(false); load(); }}
        />
      )}
    </div>
  );
}

function AttachModal({
  jobId,
  onClose,
  onUploaded,
}: {
  jobId: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<'QUOTE' | 'INVOICE' | 'OTHER'>('QUOTE');
  const [refNumber, setRefNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [documentDate, setDocumentDate] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!file) { setError('Attach the PDF you exported from RentalWorks.'); return; }
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', kind);
      fd.append('refNumber', refNumber);
      fd.append('amount', amount);
      fd.append('documentDate', documentDate);
      fd.append('note', note);
      const r = await fetch(`/api/jobs/${jobId}/documents`, { method: 'POST', body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || 'Upload failed.'); return; }
      onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-2xl p-5 w-full max-w-lg space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-[16px] font-semibold text-white">Attach a RentalWorks document</h3>
          <p className="text-[12px] text-zinc-400 mt-0.5">
            Export the quote or invoice PDF from RentalWorks, then drop it here so it lives with the job.
          </p>
        </div>

        <div className="flex gap-2">
          {(['QUOTE', 'INVOICE', 'OTHER'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`flex-1 px-3 py-2 rounded-lg border text-[13px] font-semibold transition-colors ${
                kind === k
                  ? 'border-amber-600 bg-amber-950/30 text-amber-300'
                  : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-600'
              }`}
            >
              {k === 'QUOTE' ? 'Quote' : k === 'INVOICE' ? 'Invoice' : 'Other'}
            </button>
          ))}
        </div>

        <FileDropzone file={file} onFile={setFile} hint="PDF exported from RentalWorks · max 25 MB" />

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">RW number</span>
            <input
              value={refNumber}
              onChange={(e) => setRefNumber(e.target.value)}
              placeholder="e.g. 404090"
              className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-[14px] text-white focus:outline-none focus:border-zinc-500"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Amount ($)</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="optional"
              className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-[14px] text-white focus:outline-none focus:border-zinc-500"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Document date</span>
            <input
              type="date"
              value={documentDate}
              onChange={(e) => setDocumentDate(e.target.value)}
              className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-[14px] text-white focus:outline-none focus:border-zinc-500"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Note</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="optional"
              className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-[14px] text-white focus:outline-none focus:border-zinc-500"
            />
          </label>
        </div>

        {error && <div className="text-[13px] text-rose-400">{error}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-1.5 text-[13px] text-zinc-300 hover:text-white">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || !file}
            className="px-3 py-1.5 text-[13px] font-semibold bg-amber-600 hover:bg-amber-500 text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Uploading…' : 'Attach document'}
          </button>
        </div>
      </div>
    </div>
  );
}
