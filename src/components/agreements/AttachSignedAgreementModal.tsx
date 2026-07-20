'use client';

import { useRef, useState } from 'react';

/**
 * Internal attach modal for an agreement signed OUTSIDE the portal — the
 * offline/backfill path. Files the countersigned PDF on an order's
 * SignedAgreement so HQ reads "Signed" without a re-sign. On success the
 * parent reloads. POSTs multipart to /api/orders/[id]/agreement/attach-signed.
 */
export function AttachSignedAgreementModal({
  orderId,
  orderNumber,
  defaultContractType = 'RENTAL_AGREEMENT',
  onClose,
  onAttached,
}: {
  orderId: string;
  orderNumber: string;
  defaultContractType?: 'RENTAL_AGREEMENT' | 'STAGE_CONTRACT';
  onClose: () => void;
  onAttached: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [contractType, setContractType] = useState(defaultContractType);
  const [signerName, setSignerName] = useState('');
  const [signedDate, setSignedDate] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Choose the signed PDF to attach.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('contractType', contractType);
      if (signerName.trim()) fd.append('signerName', signerName.trim());
      if (signedDate) fd.append('signedDate', signedDate);
      if (note.trim()) fd.append('note', note.trim());
      const res = await fetch(`/api/orders/${orderId}/agreement/attach-signed`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Attach failed.');
        setSaving(false);
        return;
      }
      onAttached();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-white">Attach signed agreement</h3>
            <p className="text-[11px] text-zinc-500">Order {orderNumber} · signed outside the portal</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">×</button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Agreement type
            </label>
            <select
              value={contractType}
              onChange={(e) => setContractType(e.target.value as 'RENTAL_AGREEMENT' | 'STAGE_CONTRACT')}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white focus:border-zinc-500 focus:outline-none"
            >
              <option value="RENTAL_AGREEMENT">Rental Agreement</option>
              <option value="STAGE_CONTRACT">Stage Contract</option>
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Signed PDF
            </label>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
              className="block w-full text-sm text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-600 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-amber-500"
            />
            {fileName && <p className="mt-1 truncate text-[11px] text-zinc-400">{fileName}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                Signer <span className="text-zinc-600">(optional)</span>
              </label>
              <input
                type="text"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Name on signature"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                Signed date <span className="text-zinc-600">(optional)</span>
              </label>
              <input
                type="date"
                value={signedDate}
                onChange={(e) => setSignedDate(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white focus:border-zinc-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Note <span className="text-zinc-600">(optional)</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="e.g. Wet-signed on set 7/17, scanned by production"
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
            {saving ? 'Attaching…' : 'Attach signed'}
          </button>
        </div>
      </div>
    </div>
  );
}
