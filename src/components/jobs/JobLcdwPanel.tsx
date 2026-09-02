'use client';

/**
 * The job's damage-waiver election, on the staff side.
 *
 * For a company on an annual agreement this is the ONLY thing the client was
 * asked for (Wes, 2026-09-01), which makes it the only thing that can be
 * outstanding — so it gets a row of its own rather than living inside the
 * per-booking chips, where an unanswered waiver on a job with no bookings was
 * invisible.
 *
 * Three affordances, in order of how often they're needed:
 *
 *  - See the answer, who gave it, and when.
 *  - Record it on the client's behalf. Clients answer by phone and email far
 *    more often than they log into a portal, and an election recorded by a
 *    rep with their name on it is a better record than a chased-and-never-
 *    answered blank.
 *  - Re-cut the addendum. The PDF is best-effort at election time (a render
 *    failure must never lose the client's answer), and the addendum prints
 *    the job name and the covered vehicles — both of which move.
 *
 * Recording an election never applies the $24/day fee. That stays on the
 * order, where the per-line eligibility rule runs.
 */

import { useState } from 'react';

export interface LcdwElectionShape {
  decision: 'ACCEPTED' | 'DECLINED';
  decidedAt: string;
  signerName: string | null;
  signerTitle: string | null;
  source: string;
}

export function JobLcdwPanel({
  jobId,
  election,
  hasAnnualCoverage,
  onChanged,
}: {
  jobId: string;
  election: LcdwElectionShape | null;
  hasAnnualCoverage: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<'ACCEPTED' | 'DECLINED' | ''>('');
  const [signerName, setSignerName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const record = async () => {
    if (!decision || !signerName.trim()) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await fetch(`/api/jobs/${jobId}/lcdw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, signerName: signerName.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j?.error || 'Could not record the election.');
        return;
      }
      setMsg(
        j.addendumFiled
          ? 'Recorded — addendum filed on the job.'
          : 'Recorded. No annual agreement is auto-covering this company, so no addendum was filed.',
      );
      setOpen(false);
      setDecision('');
      setSignerName('');
      onChanged();
    } catch {
      setError('Could not record the election.');
    } finally {
      setBusy(false);
    }
  };

  const recut = async () => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await fetch(`/api/jobs/${jobId}/lcdw`, { method: 'PUT' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j?.error || 'Could not regenerate the addendum.');
        return;
      }
      setMsg('Addendum regenerated.');
      onChanged();
    } catch {
      setError('Could not regenerate the addendum.');
    } finally {
      setBusy(false);
    }
  };

  const accepted = election?.decision === 'ACCEPTED';

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
            election
              ? accepted
                ? 'text-emerald-700 bg-emerald-50'
                : 'text-zinc-700 bg-zinc-200'
              : 'text-amber-700 bg-amber-50'
          }`}
        >
          {election ? (accepted ? 'LCDW accepted' : 'LCDW declined') : 'LCDW unanswered'}
        </span>
        <span className="text-[15px] text-zinc-900 font-medium">Damage waiver</span>
        {hasAnnualCoverage && !election && (
          /* On an annual account this is the whole ask — so an unanswered
             waiver is not a minor gap, it is the job's only open paperwork. */
          <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 uppercase tracking-wider">
            Only paperwork outstanding
          </span>
        )}
      </div>

      <div className="mt-1 text-[12px] text-zinc-700">
        {election ? (
          <>
            {election.signerName || 'Client'}
            {election.signerTitle ? ` · ${election.signerTitle}` : ''} on{' '}
            {new Date(election.decidedAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
            {election.source === 'STAFF' ? ' · recorded by SirReel' : ' · elected in portal'}
          </>
        ) : (
          'The client has not accepted or declined the waiver yet.'
        )}
      </div>

      {msg && <div className="mt-1.5 text-[12px] text-emerald-700">{msg}</div>}
      {error && <div className="mt-1.5 text-[12px] text-rose-600">{error}</div>}

      <div className="mt-1.5 flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-[13px] font-semibold text-amber-700 hover:text-amber-800"
        >
          {election ? 'Change the answer' : 'Record their answer'}
        </button>
        {election && (
          <button
            onClick={recut}
            disabled={busy}
            className="text-[13px] font-semibold text-zinc-600 hover:text-zinc-900 disabled:opacity-40"
          >
            {busy ? 'Working…' : 'Re-cut addendum'}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2.5 rounded-lg border border-zinc-200 bg-white p-3 space-y-2.5">
          <p className="text-[12px] text-zinc-600">
            Record what the client told you. Their name goes on the addendum, so use the
            person who actually gave you the answer.
          </p>
          <div className="flex gap-2 flex-wrap">
            {(['ACCEPTED', 'DECLINED'] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDecision(d)}
                className={`text-[13px] font-semibold px-3 py-1.5 rounded-lg border ${
                  decision === d
                    ? 'border-zinc-900 bg-zinc-900 text-white'
                    : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400'
                }`}
              >
                {d === 'ACCEPTED' ? 'Accepted' : 'Declined'}
              </button>
            ))}
          </div>
          <input
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            placeholder="Who told you — first and last name"
            className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-[13px]"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={record}
              disabled={busy || !decision || !signerName.trim()}
              className="text-[13px] font-semibold bg-zinc-900 hover:bg-zinc-800 text-white px-3 py-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? 'Recording…' : 'Record election'}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-[13px] text-zinc-600 hover:text-zinc-900"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
