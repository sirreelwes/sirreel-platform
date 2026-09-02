'use client';

/**
 * Annual-account setup — which filed master, if any, papers this company's
 * jobs automatically.
 *
 * Wes, 2026-09-01: "I need to set up some companies for Annual Agreements,
 * where they are automatically approved on the rental agreement and only
 * asked to elect or deny LCDW."
 *
 * This is the switch. Turning it on for a master stops asking that company's
 * clients to sign a rental agreement per job — so the panel refuses to be
 * coy about it: the consequence is stated on the control, the covering
 * agreement is named, and a master that is flagged but out of window is
 * called out rather than shown as active. "Why did this client never sign?"
 * has to be answerable from here.
 *
 * Masters are FILED from a job (the Link/File agreement modal). Filing is
 * per-job by nature — you attach a job to a master — so this panel
 * configures, and doesn't duplicate the upload.
 */

import { useCallback, useEffect, useState } from 'react';
import { FileDropzone } from '@/components/ui/FileDropzone';

interface Agreement {
  id: string;
  contractType: string;
  title: string | null;
  isAnnual: boolean;
  autoCoverJobs: boolean;
  effectiveDate: string | null;
  expiryDate: string | null;
  signerName: string | null;
  signedAt: string | null;
  originalFilename: string;
  standingLcdwDecision: 'ACCEPTED' | 'DECLINED' | null;
  jobsAttached: number;
  flaggedButInactive: boolean;
}

function fmt(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function AnnualAgreementPanel({
  companyId,
  canEdit,
}: {
  companyId: string;
  canEdit: boolean;
}) {
  const [agreements, setAgreements] = useState<Agreement[] | null>(null);
  const [coveringId, setCoveringId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // File-a-master form. Lives here because an annual agreement is a COMPANY
  // fact: it is signed before the first job exists, and until now the only
  // way to file one was through a job — so an account like Fox Sports, with
  // an executed agreement and no jobs yet, could not be set up at all.
  const [filing, setFiling] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signedDate, setSignedDate] = useState('');
  const [newLcdw, setNewLcdw] = useState('');
  const [newAutoCover, setNewAutoCover] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/crm/companies/${companyId}/agreements`);
      if (!r.ok) throw new Error('load');
      const d = await r.json();
      setAgreements(d.agreements || []);
      setCoveringId(d.coveringId ?? null);
    } catch {
      setAgreements([]);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      const r = await fetch(`/api/agreements/company/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j?.error || 'Could not save.');
        return;
      }
      await load();
    } catch {
      setError('Could not save.');
    } finally {
      setBusyId(null);
    }
  };

  const submitFile = async () => {
    if (!file) {
      setError('Attach the signed agreement PDF.');
      return;
    }
    if (newAutoCover && !expiryDate) {
      setError('An auto-covering agreement needs an expiration date.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('contractType', 'RENTAL_AGREEMENT');
      // Filed from this panel it is always the annual master — that is what
      // the panel is for. A one-off attaches to a job, from the job.
      fd.append('isAnnual', 'true');
      fd.append('autoCoverJobs', String(newAutoCover));
      if (title.trim()) fd.append('title', title.trim());
      if (effectiveDate) fd.append('effectiveDate', effectiveDate);
      if (expiryDate) fd.append('expiryDate', expiryDate);
      if (signerName.trim()) fd.append('signerName', signerName.trim());
      if (signedDate) fd.append('signedDate', signedDate);
      if (newLcdw) fd.append('standingLcdwDecision', newLcdw);

      const r = await fetch(`/api/crm/companies/${companyId}/agreements`, {
        method: 'POST',
        body: fd,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j?.error || 'Could not file the agreement.');
        return;
      }
      setFiling(false);
      setFile(null);
      setTitle('');
      setEffectiveDate('');
      setExpiryDate('');
      setSignerName('');
      setSignedDate('');
      setNewLcdw('');
      await load();
    } catch {
      setError('Could not file the agreement.');
    } finally {
      setSaving(false);
    }
  };

  const fileForm = (
    <div className="mt-3 rounded-lg border border-lt-hairline p-3 space-y-3">
      <FileDropzone accept="application/pdf" file={file} onFile={setFile} />
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-[11px] text-lt-fg3 mb-0.5">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="2026 Annual Rental Agreement"
            className="w-full rounded-md border border-lt-hairline px-2 py-1 text-xs"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] text-lt-fg3 mb-0.5">Signed by</span>
          <input
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            className="w-full rounded-md border border-lt-hairline px-2 py-1 text-xs"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] text-lt-fg3 mb-0.5">Agreement date</span>
          <input
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            className="w-full rounded-md border border-lt-hairline px-2 py-1 text-xs"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] text-lt-fg3 mb-0.5">
            Expiration date{newAutoCover ? ' *' : ''}
          </span>
          <input
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            className="w-full rounded-md border border-lt-hairline px-2 py-1 text-xs"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] text-lt-fg3 mb-0.5">Signed on</span>
          <input
            type="date"
            value={signedDate}
            onChange={(e) => setSignedDate(e.target.value)}
            className="w-full rounded-md border border-lt-hairline px-2 py-1 text-xs"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] text-lt-fg3 mb-0.5">LCDW on the agreement</span>
          <select
            value={newLcdw}
            onChange={(e) => setNewLcdw(e.target.value)}
            className="w-full rounded-md border border-lt-hairline px-2 py-1 text-xs"
          >
            <option value="">Not recorded — ask per job</option>
            <option value="ACCEPTED">Accepted for all fleet vehicles</option>
            <option value="DECLINED">Declined for all fleet vehicles</option>
          </select>
        </label>
      </div>
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={newAutoCover}
          onChange={(e) => setNewAutoCover(e.target.checked)}
        />
        <span className="text-xs text-lt-fg2 leading-relaxed">
          Auto-cover this company&rsquo;s jobs.{' '}
          <span className="text-lt-fg3">
            Clients are never asked to sign per job; each job gets an addendum with its
            name, dates and the LCDW election.
          </span>
        </span>
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={submitFile}
          className="rounded-md bg-lt-fg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          {saving ? 'Filing…' : 'File agreement'}
        </button>
        <button
          type="button"
          onClick={() => {
            setFiling(false);
            setError(null);
          }}
          className="text-xs text-lt-fg2 hover:text-black"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  if (!agreements) return null;
  if (agreements.length === 0) {
    return (
      <div className="mt-4 pt-4 border-t border-lt-hairline">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-lt-fg3 mb-1">
          Annual agreement
        </div>
        {error && <p className="text-xs text-chip-bad-fg mb-2">{error}</p>}
        {filing ? (
          fileForm
        ) : (
          <>
            <p className="text-xs text-lt-fg3">
              No master agreement on file.
            </p>
            {canEdit && (
              <button
                type="button"
                onClick={() => setFiling(true)}
                className="mt-1.5 text-xs font-medium text-lt-fg hover:text-black"
              >
                + File annual agreement
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-lt-hairline">
      <div className="flex items-baseline justify-between gap-2 mb-2 flex-wrap">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-lt-fg3">
          Agreements on file
        </div>
        {coveringId ? (
          <span className="text-[10px] uppercase tracking-wider font-semibold text-chip-good-fg bg-chip-good-bg px-2 py-0.5 rounded">
            Annual account · clients don&rsquo;t sign per job
          </span>
        ) : null}
      </div>

      {error && <p className="text-xs text-chip-bad-fg mb-2">{error}</p>}

      <div className="space-y-2">
        {agreements.map((a) => {
          const covering = a.id === coveringId;
          return (
            <div
              key={a.id}
              className={`rounded-lg border p-3 ${
                covering ? 'border-chip-good-fg/40 bg-chip-good-bg/30' : 'border-lt-hairline'
              }`}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-lt-fg">
                    {a.title || a.originalFilename}
                  </div>
                  <div className="text-[11px] text-lt-fg3 mt-0.5">
                    {a.contractType === 'STAGE_CONTRACT' ? 'Stage contract' : 'Rental agreement'}
                    {a.isAnnual ? ' · annual' : ' · one-off'} · {fmt(a.effectiveDate)} –{' '}
                    {a.expiryDate ? fmt(a.expiryDate) : 'open'}
                    {a.jobsAttached > 0
                      ? ` · ${a.jobsAttached} job${a.jobsAttached === 1 ? '' : 's'} attached`
                      : ''}
                  </div>
                  {a.flaggedButInactive && (
                    /* The failure this exists to make visible: someone set
                       auto-cover, the window has since lapsed, and clients
                       quietly started being asked to sign again. */
                    <div className="mt-1 text-[11px] text-chip-bad-fg">
                      Set to auto-cover, but the coverage window is{' '}
                      {a.expiryDate && new Date(a.expiryDate) < new Date()
                        ? 'expired'
                        : 'not open yet'}{' '}
                      — clients on this company are being asked to sign per job.
                    </div>
                  )}
                </div>
                <a
                  href={`/api/agreements/company/${a.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-lt-fg hover:text-black shrink-0"
                >
                  Open PDF ↗
                </a>
              </div>

              {canEdit && (
                <label className="mt-2 flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={a.autoCoverJobs}
                    disabled={busyId === a.id || !a.isAnnual}
                    onChange={(e) => patch(a.id, { autoCoverJobs: e.target.checked })}
                  />
                  <span className="text-xs text-lt-fg2 leading-relaxed">
                    {a.isAnnual ? (
                      <>
                        Auto-cover this company&rsquo;s jobs.{' '}
                        <span className="text-lt-fg3">
                          Clients are not asked to sign a rental agreement — each job gets an
                          addendum naming this agreement, its job name and dates, and the LCDW
                          election.
                        </span>
                      </>
                    ) : (
                      <span className="text-lt-fg3">
                        Mark this agreement annual (when filing) before it can auto-cover jobs.
                      </span>
                    )}
                  </span>
                </label>
              )}

              {canEdit && a.isAnnual && (
                /* The LCDW answer signed ON the master. The annual rental
                   agreement form asks it directly ("I accept/decline LCDW for
                   all fleet vehicle rentals") — record it here and every job
                   starts from the client's real answer instead of re-asking a
                   question they signed for the year. */
                <label className="mt-2 flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-lt-fg2">LCDW on the agreement:</span>
                  <select
                    value={a.standingLcdwDecision || ''}
                    disabled={busyId === a.id}
                    onChange={(e) => patch(a.id, { standingLcdwDecision: e.target.value })}
                    className="rounded-md border border-lt-hairline px-2 py-1 text-xs"
                  >
                    <option value="">Not recorded — ask per job</option>
                    <option value="ACCEPTED">Accepted for all fleet vehicles</option>
                    <option value="DECLINED">Declined for all fleet vehicles</option>
                  </select>
                </label>
              )}
            </div>
          );
        })}
      </div>

      {canEdit && (filing ? fileForm : (
        <button
          type="button"
          onClick={() => setFiling(true)}
          className="mt-2 text-xs font-medium text-lt-fg hover:text-black"
        >
          + File another agreement
        </button>
      ))}
    </div>
  );
}
