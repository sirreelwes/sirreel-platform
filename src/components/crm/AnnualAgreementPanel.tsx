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

  if (!agreements) return null;
  if (agreements.length === 0) {
    return (
      <div className="mt-4 pt-4 border-t border-lt-hairline">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-lt-fg3 mb-1">
          Annual agreement
        </div>
        <p className="text-xs text-lt-fg3">
          No master agreement on file. File one from any job on this company (Agreements →
          File new), then set it to auto-cover here.
        </p>
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
                          Clients are not asked to sign a rental agreement — the portal asks
                          only for the LCDW election, and each job gets an addendum naming
                          this agreement.
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
