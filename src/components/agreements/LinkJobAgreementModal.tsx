'use client';

import { useEffect, useRef, useState } from 'react';

interface OnFileAgreement {
  id: string;
  contractType: string;
  title: string | null;
  isAnnual: boolean;
  effectiveDate: string | null;
  expiryDate: string | null;
  originalFilename: string;
}

/**
 * Attach a job to an agreement on file. Two paths:
 *  - Link: pick an existing on-file (often annual) agreement for the
 *    company and add this job to it as an addendum (optional signed
 *    addendum page).
 *  - File new: upload a new master agreement (rental/stage, annual or
 *    one-off) and link this job in one step.
 */
export function LinkJobAgreementModal({
  jobId,
  companyName,
  onClose,
  onDone,
}: {
  jobId: string;
  companyName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [tab, setTab] = useState<'link' | 'file'>('link');
  const [onFile, setOnFile] = useState<OnFileAgreement[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Link-mode optional addendum
  const addendumRef = useRef<HTMLInputElement>(null);
  const [linkNote, setLinkNote] = useState('');

  // File-mode fields
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [contractType, setContractType] = useState<'RENTAL_AGREEMENT' | 'STAGE_CONTRACT'>('RENTAL_AGREEMENT');
  const [title, setTitle] = useState('');
  const [isAnnual, setIsAnnual] = useState(false);
  const [effectiveDate, setEffectiveDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signedDate, setSignedDate] = useState('');
  const [fileNote, setFileNote] = useState('');

  useEffect(() => {
    fetch(`/api/jobs/${jobId}/agreements`)
      .then((r) => r.json())
      .then((d) => {
        const list: OnFileAgreement[] = d.companyAgreements || [];
        setOnFile(list);
        if (list.length === 0) setTab('file');
        else setSelectedId(list[0].id);
      })
      .catch(() => setOnFile([]));
  }, [jobId]);

  const submitLink = async () => {
    if (!selectedId) {
      setError('Pick an agreement to link.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('mode', 'link');
      fd.append('companyAgreementId', selectedId);
      if (linkNote.trim()) fd.append('note', linkNote.trim());
      const add = addendumRef.current?.files?.[0];
      if (add) fd.append('addendumFile', add);
      const res = await fetch(`/api/jobs/${jobId}/agreements`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Link failed.');
        setSaving(false);
        return;
      }
      onDone();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  const submitFile = async () => {
    const f = fileRef.current?.files?.[0];
    if (!f) {
      setError('Choose the agreement PDF.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('mode', 'file');
      fd.append('file', f);
      fd.append('contractType', contractType);
      fd.append('isAnnual', isAnnual ? 'true' : 'false');
      if (title.trim()) fd.append('title', title.trim());
      if (isAnnual && effectiveDate) fd.append('effectiveDate', effectiveDate);
      if (isAnnual && expiryDate) fd.append('expiryDate', expiryDate);
      if (signerName.trim()) fd.append('signerName', signerName.trim());
      if (signedDate) fd.append('signedDate', signedDate);
      if (fileNote.trim()) fd.append('note', fileNote.trim());
      const res = await fetch(`/api/jobs/${jobId}/agreements`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Upload failed.');
        setSaving(false);
        return;
      }
      onDone();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  const tabCls = (t: 'link' | 'file') =>
    `flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
      tab === t ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
    }`;
  const label = 'mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-zinc-500';
  const input = 'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-white">Agreement on file</h3>
            <p className="text-[11px] text-zinc-500">Attach this job to a rental / stage agreement · {companyName}</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">×</button>
        </div>

        <div className="px-5 pt-4">
          <div className="flex gap-2">
            <button className={tabCls('link')} onClick={() => setTab('link')}>Link existing</button>
            <button className={tabCls('file')} onClick={() => setTab('file')}>File new</button>
          </div>
        </div>

        {tab === 'link' ? (
          <div className="space-y-4 px-5 py-4">
            {onFile === null ? (
              <p className="text-sm text-zinc-500">Loading agreements on file…</p>
            ) : onFile.length === 0 ? (
              <p className="text-sm text-zinc-500">
                No agreements on file for {companyName} yet. Switch to <span className="text-zinc-300">File new</span> to add one.
              </p>
            ) : (
              <>
                <div>
                  <label className={label}>Agreement on file</label>
                  <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className={input}>
                    {onFile.map((a) => (
                      <option key={a.id} value={a.id}>
                        {(a.title || a.contractType.replace(/_/g, ' '))}
                        {a.isAnnual ? ' · Annual' : ''}
                        {a.expiryDate ? ` · exp ${a.expiryDate.slice(0, 10)}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label}>Signed addendum page <span className="text-zinc-600">(optional PDF)</span></label>
                  <input
                    ref={addendumRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    className="block w-full text-sm text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-700 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-zinc-600"
                  />
                </div>
                <div>
                  <label className={label}>Note <span className="text-zinc-600">(optional)</span></label>
                  <input type="text" value={linkNote} onChange={(e) => setLinkNote(e.target.value)} placeholder="e.g. Added under 2026 master" className={input} />
                </div>
              </>
            )}
            {error && <p className="text-sm text-rose-400">{error}</p>}
          </div>
        ) : (
          <div className="space-y-4 px-5 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Type</label>
                <select value={contractType} onChange={(e) => setContractType(e.target.value as 'RENTAL_AGREEMENT' | 'STAGE_CONTRACT')} className={input}>
                  <option value="RENTAL_AGREEMENT">Rental Agreement</option>
                  <option value="STAGE_CONTRACT">Stage Contract</option>
                </select>
              </div>
              <div>
                <label className={label}>Title <span className="text-zinc-600">(optional)</span></label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="2026 Annual Rental" className={input} />
              </div>
            </div>
            <div>
              <label className={label}>Agreement PDF</label>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
                className="block w-full text-sm text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-600 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-amber-500"
              />
              {fileName && <p className="mt-1 truncate text-[11px] text-zinc-400">{fileName}</p>}
            </div>
            <label className="flex cursor-pointer items-center gap-2.5">
              <input type="checkbox" checked={isAnnual} onChange={(e) => setIsAnnual(e.target.checked)} className="h-4 w-4 accent-amber-600" />
              <span className="text-sm text-zinc-300">Annual / standing agreement (covers multiple jobs)</span>
            </label>
            {isAnnual && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>Effective</label>
                  <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className={input} />
                </div>
                <div>
                  <label className={label}>Expires</label>
                  <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className={input} />
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Signer <span className="text-zinc-600">(optional)</span></label>
                <input type="text" value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Name" className={input} />
              </div>
              <div>
                <label className={label}>Signed date <span className="text-zinc-600">(optional)</span></label>
                <input type="date" value={signedDate} onChange={(e) => setSignedDate(e.target.value)} className={input} />
              </div>
            </div>
            <div>
              <label className={label}>Note <span className="text-zinc-600">(optional)</span></label>
              <input type="text" value={fileNote} onChange={(e) => setFileNote(e.target.value)} placeholder="e.g. Emailed by production 7/18" className={input} />
            </div>
            {error && <p className="text-sm text-rose-400">{error}</p>}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-4">
          <button onClick={onClose} disabled={saving} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-zinc-400 hover:text-zinc-200 disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={tab === 'link' ? submitLink : submitFile}
            disabled={saving || (tab === 'link' && (onFile?.length ?? 0) === 0)}
            className="rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : tab === 'link' ? 'Link to job' : 'File & link'}
          </button>
        </div>
      </div>
    </div>
  );
}
