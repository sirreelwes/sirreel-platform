'use client';

/**
 * Damage-waiver election — the one thing an annual-agreement client is asked
 * for on a job.
 *
 * Wes, 2026-09-01: annual companies are "automatically approved on the rental
 * agreement and only asked to elect or deny LCDW."
 *
 * Design rules carried over from the rental sign page, for the same reasons:
 *
 *   - The terms are RENDERED, not linked. LCDW is a liability position and a
 *     $24/day/vehicle charge; a client electing it must be able to read what
 *     they are electing on the screen they elect it on.
 *   - Both answers are signed. A DECLINE is the half we would actually have
 *     to prove — "we asked and they said no" is worth nothing without a name
 *     on it, and the addendum itself demands the confirmation in writing.
 *   - The list of vehicles is concrete. The generic eligibility paragraph
 *     left clients to work out whether their own order was covered; a client
 *     with a PopVan could accept, pay, and learn at claim time that their
 *     vehicle was never eligible.
 *   - Nothing is preselected. A default here is a decision made for the
 *     client on a question with money and liability attached.
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PORTAL, PORTAL_SERIF } from '@/lib/brand/portalTokens';

interface LcdwData {
  ratePerDay: number;
  terms: { title: string; coverage: string; exclusions: string; scope: string; note: string };
  acknowledgementText: string;
  covered: string[];
  excluded: { description: string; reason: string }[];
  allExcluded: boolean;
  hasVehicles: boolean;
  election: {
    decision: 'ACCEPTED' | 'DECLINED';
    decidedAt: string;
    signerName: string | null;
    acknowledgedAt: string | null;
  } | null;
  acknowledgementRequired: boolean;
  effective: { decision: 'ACCEPTED' | 'DECLINED'; source: 'JOB' | 'ANNUAL' } | null;
  standingDecision: 'ACCEPTED' | 'DECLINED' | null;
  annualAgreement: {
    title: string;
    companyName: string | null;
    standingLcdwDecision: 'ACCEPTED' | 'DECLINED' | null;
  } | null;
}

export default function LcdwElectionPage() {
  const params = useParams();
  const router = useRouter();
  const slug = String(params?.slug || '');

  const [data, setData] = useState<LcdwData | null>(null);
  const [choice, setChoice] = useState<'ACCEPTED' | 'DECLINED' | null>(null);
  const [signerName, setSignerName] = useState('');
  const [signerTitle, setSignerTitle] = useState('Producer');
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [lr, dr] = await Promise.all([
          fetch('/api/portal/job/lcdw'),
          fetch('/api/portal/job/data'),
        ]);
        if (!lr.ok) throw new Error('load');
        const l = (await lr.json()) as LcdwData;
        if (cancelled) return;
        setData(l);
        // Open on the answer that already governs — the per-job election if
        // there is one, otherwise the standing election signed on the annual
        // agreement. This is NOT a default invented for the client: it is the
        // answer they gave, shown so they can change it in one click. With
        // neither, the choice stays blank, because on a question with money
        // and liability attached, picking one for them is not ours to do.
        // Nothing eligible on the job → the only honest record is DECLINED
        // (no waiver applies), so the acknowledgement is not blocked behind a
        // choice the client cannot meaningfully make.
        const nothingEligible = !l.hasVehicles || l.allExcluded || l.covered.length === 0;
        if (nothingEligible) setChoice('DECLINED');
        else if (l.effective) setChoice(l.effective.decision);
        const d = dr.ok ? await dr.json() : null;
        const full = `${d?.contact?.firstName || ''} ${d?.contact?.lastName || ''}`.trim();
        if (full) setSignerName(full);
      } catch {
        if (!cancelled) setError('Could not load the damage-waiver options.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async () => {
    if (!choice || !signerName.trim() || !acknowledged) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/portal/job/lcdw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: choice,
          signerName: signerName.trim(),
          signerTitle: signerTitle.trim() || null,
          acknowledged: acknowledged,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j?.error || 'Could not save your election. Please try again.');
        return;
      }
      setDone(true);
      setTimeout(() => router.push(`/portal/job/${slug}`), 1800);
    } catch {
      setError('Could not save your election. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-sm text-gray-500">Loading…</div>
    );
  }

  if (error && !data) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16">
        <p className="text-sm text-red-600">{error}</p>
        <a href={`/portal/job/${slug}`} className="mt-4 inline-block text-sm underline text-gray-600">
          ← Back to your portal
        </a>
      </div>
    );
  }

  if (!data) return null;

  if (done) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: PORTAL_SERIF }}>
          Recorded — thank you
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Your damage-waiver election has been added to your job file. Taking you back to
          your portal…
        </p>
      </div>
    );
  }

  // Vehicles booked, none eligible. Offering the choice here would be
  // offering coverage that does not exist.
  const unavailable = !data.hasVehicles || data.allExcluded || data.covered.length === 0;

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
      <div>
        <a href={`/portal/job/${slug}`} className="text-xs text-gray-500 hover:text-gray-800 underline">
          ← Back to your portal
        </a>
        <h1
          className="mt-3 text-2xl font-bold text-gray-900"
          style={{ fontFamily: PORTAL_SERIF }}
        >
          {data.annualAgreement ? 'Confirm your agreement' : data.terms.title}
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          {data.annualAgreement
            ? `Two things to confirm for this job: that your ${data.annualAgreement.title} is on file, and your damage-waiver election.`
            : `$${data.ratePerDay}/day, per eligible vehicle. Accept or decline — we need your answer either way.`}
        </p>
      </div>

      {/* The agreement being acknowledged. Named and readable: a client
          cannot meaningfully confirm a document is on file if the page will
          not show them which one. */}
      {data.annualAgreement && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 space-y-2">
          <h2 className="text-sm font-bold text-emerald-900">Your agreement on file</h2>
          <p className="text-[13px] leading-relaxed text-emerald-900">
            {data.annualAgreement.companyName
              ? `${data.annualAgreement.companyName}'s `
              : 'Your '}
            {data.annualAgreement.title} is on file with SirReel and in effect for this job.
            There is nothing to sign — its terms apply in full.
          </p>
          <a
            href="/api/portal/job/agreement/annual"
            target="_blank"
            rel="noreferrer"
            className="inline-block text-xs font-semibold text-emerald-800 underline hover:text-emerald-900"
          >
            Read the agreement
          </a>
        </section>
      )}

      {/* What it applies to on THIS job. */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3 shadow-sm">
        <h2 className="text-sm font-bold text-gray-900">What this covers on your job</h2>
        {data.covered.length > 0 ? (
          <ul className="space-y-1">
            {data.covered.map((v) => (
              <li key={v} className="text-sm text-gray-700">
                • {v}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">No eligible vehicles on this job.</p>
        )}
        {data.excluded.length > 0 && (
          <div className="pt-2 border-t border-gray-100">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
              Not eligible
            </p>
            <ul className="space-y-1">
              {data.excluded.map((v) => (
                <li key={v.description} className="text-sm text-gray-500">
                  • {v.description} — {v.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* The terms themselves, on the page where the choice is made. */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3 shadow-sm">
        <h2 className="text-sm font-bold text-gray-900">The terms</h2>
        <p className="text-[13px] leading-relaxed text-gray-700">{data.terms.coverage}</p>
        <p className="text-[13px] leading-relaxed text-gray-700">{data.terms.exclusions}</p>
        <p className="text-[13px] leading-relaxed text-gray-700">{data.terms.scope}</p>
        <p className="text-xs italic text-gray-500">{data.terms.note}</p>
      </section>

      {unavailable && !data.annualAgreement ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-600">
            The damage waiver isn&rsquo;t available on the vehicles booked for this job, so
            there is nothing to elect. Your rental agreement terms apply as written.
          </p>
        </section>
      ) : (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 shadow-sm">
          <h2 className="text-sm font-bold text-gray-900">
            {data.annualAgreement ? 'Confirm and sign' : 'Your election'}
          </h2>

          {data.election ? (
            <p className="text-xs text-gray-500">
              You previously {data.election.decision === 'ACCEPTED' ? 'accepted' : 'declined'} the
              waiver on{' '}
              {new Date(data.election.decidedAt).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
              . Submitting again replaces that answer.
            </p>
          ) : data.standingDecision ? (
            <p className="text-xs text-gray-500">
              Your {data.annualAgreement?.title || 'annual agreement'}{' '}
              {data.standingDecision === 'ACCEPTED' ? 'accepts' : 'declines'} the waiver for all
              fleet vehicle rentals, so that applies here already. Submit only if you want a
              different answer for this job — it won&rsquo;t change your annual agreement.
            </p>
          ) : null}

          {/* Nothing on the job can carry the waiver, but the agreement still
              has to be acknowledged. Offering accept/decline here would be
              offering a choice with one real option; the record says DECLINED
              because no waiver applies, and the copy says why. */}
          {unavailable ? (
            <p className="text-xs text-gray-600 leading-relaxed">
              The damage waiver isn&rsquo;t available on the vehicles booked for this job, so
              there is nothing to elect — no waiver charge applies. We still need you to
              confirm your agreement is on file.
            </p>
          ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                {
                  key: 'ACCEPTED' as const,
                  title: 'Accept the waiver',
                  body: `$${data.ratePerDay}/day per eligible vehicle. SirReel waives its claim to the first $1,000 of collision damage.`,
                },
                {
                  key: 'DECLINED' as const,
                  title: 'Decline the waiver',
                  body: 'No waiver charge. You remain responsible for all loss of or damage to the vehicles under the rental agreement.',
                },
              ]
            ).map((opt) => {
              const selected = choice === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setChoice(opt.key)}
                  aria-pressed={selected}
                  className={`text-left rounded-xl border p-4 transition ${
                    selected
                      ? 'border-gray-900 bg-gray-50 ring-2 ring-gray-900'
                      : 'border-gray-200 hover:border-gray-400'
                  }`}
                >
                  <div className="text-sm font-bold text-gray-900">{opt.title}</div>
                  <div className="mt-1 text-xs leading-relaxed text-gray-600">{opt.body}</div>
                </button>
              );
            })}
          </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="block text-xs font-semibold text-gray-600 mb-1">Your name</span>
              <input
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="First Last"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-gray-600 mb-1">Title</span>
              <input
                value={signerTitle}
                onChange={(e) => setSignerTitle(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="Producer"
              />
            </label>
          </div>

          <label className="flex gap-2.5 items-start">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-xs leading-relaxed text-gray-600">
              {/* Recomposed from the LIVE choice, not the server's snapshot,
                  which was built from whatever answer was current on load. A
                  client who switches to Decline must not be asked to tick a
                  box that still says ACCEPTED — the text they agree to has to
                  be the text describing what they are agreeing. The server
                  re-composes the same sentence from the submitted decision,
                  so the stored wording matches this exactly. */}
              {data.annualAgreement && choice
                ? `I confirm that the ${data.annualAgreement.title} is on file with SirReel and in effect for this job, and that our Limited Collision Damage Waiver election for this job is ${choice === 'ACCEPTED' ? 'ACCEPTED' : 'DECLINED'}. By typing my name and submitting, I am providing my electronic signature, which has the same legal effect as a handwritten signature under the U.S. ESIGN Act and California UETA.`
                : data.acknowledgementText}
            </span>
          </label>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <button
            type="button"
            disabled={!choice || !signerName.trim() || !acknowledged || saving}
            onClick={submit}
            className="w-full sm:w-auto px-5 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: PORTAL.dark }}
          >
            {saving
              ? 'Recording…'
              : data.annualAgreement
                ? 'Confirm and sign'
                : choice === 'DECLINED'
                  ? 'Confirm decline'
                  : 'Confirm election'}
          </button>
        </section>
      )}
    </div>
  );
}
