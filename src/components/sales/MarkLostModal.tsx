'use client';

import { useState, useEffect, useCallback } from 'react';
import type { LostReason } from '@prisma/client';
import { LOST_REASON_CHOICES } from '@/lib/orders/listStatus';

/**
 * Mark a job lost, and hand back the fleet it was holding — ours and our
 * partners' (Wes 2026-09-08).
 *
 * Two things were wrong before this:
 *
 *  1. It never worked. The radio buttons sent display strings ('Other
 *     vendor', 'Budget') while /api/jobs/[id]/mark-lost validates against
 *     the LostReason ENUM, so every submit came back 400 and the job was
 *     never marked lost at all. Reasons now come from LOST_REASON_CHOICES,
 *     the same source the /orders picker uses.
 *  2. It said "all open quotes move to Lost" and left every held vehicle
 *     exactly where it was. On a BOOKED job it released nothing of ours,
 *     and it has never released a PARTNER's unit or told them — the
 *     restroom trailer stayed blocked on their calendar with no word.
 *
 * So the release is now the middle of this flow, itemised and ticked
 * rather than inferred: the whole-job case is "leave everything ticked",
 * the partial case (release the trailer, keep the motorhome) is untick the
 * ones we keep. Then a confirm step that names what goes, which partners
 * get emailed, and which need a phone call instead.
 */

interface MarkLostJob {
  id: string;
  name: string;
  jobCode: string;
  company: { name: string };
}

interface HeldUnit {
  kind: 'OURS' | 'PARTNER';
  id: string;
  label: string;
  quantity: number;
  startDate: string | null;
  endDate: string | null;
  firm: boolean;
  detail: string;
  assignedUnits: string[];
  vendorName: string | null;
  notifiesVendor: boolean;
}

interface HoldInventory {
  ours: HeldUnit[];
  partner: HeldUnit[];
}

interface MarkLostModalProps {
  job: MarkLostJob | null;
  onClose: () => void;
  onMarked: () => void;
  /** 'lost' marks the job lost and releases; 'release' only releases. */
  mode?: 'lost' | 'release';
}

const fmtRange = (a: string | null, b: string | null) => {
  if (!a && !b) return 'no dates';
  const d = (s: string) => {
    const [y, m, day] = s.split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  if (a && b) return a === b ? d(a) : `${d(a)} – ${d(b)}`;
  return d((a ?? b)!);
};

export function MarkLostModal({ job, onClose, onMarked, mode = 'lost' }: MarkLostModalProps) {
  const releaseOnly = mode === 'release';
  const [reason, setReason] = useState<LostReason | ''>('');
  const [holds, setHolds] = useState<HoldInventory | null>(null);
  const [loadingHolds, setLoadingHolds] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  // What actually happened, shown after the act rather than closing on it:
  // "we emailed King Kong" is a fact a human needs to see, not infer.
  const [result, setResult] = useState<{ notified: string[]; warnings: string[]; ours: number } | null>(null);

  const jobId = job?.id;

  useEffect(() => {
    setReason('');
    setError(null);
    setWarnings([]);
    setResult(null);
    setBusy(false);
    setConfirming(false);
    setHolds(null);
    setSelected(new Set());
    if (!jobId) return;
    let cancelled = false;
    setLoadingHolds(true);
    fetch(`/api/jobs/${jobId}/holds`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('could not load holds'))))
      .then((d: HoldInventory) => {
        if (cancelled) return;
        setHolds(d);
        // Everything ticked by default: "releasing the job completely" is
        // the common case and must not need a dozen clicks. Keeping a unit
        // is the deliberate act.
        setSelected(new Set([...d.ours, ...d.partner].map((h) => h.id)));
      })
      .catch(() => { if (!cancelled) setHolds({ ours: [], partner: [] }); })
      .finally(() => { if (!cancelled) setLoadingHolds(false); });
    return () => { cancelled = true; };
  }, [jobId]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  if (!job) return null;

  const all = [...(holds?.ours ?? []), ...(holds?.partner ?? [])];
  const chosen = all.filter((h) => selected.has(h.id));
  const chosenOurs = chosen.filter((h) => h.kind === 'OURS');
  const chosenPartner = chosen.filter((h) => h.kind === 'PARTNER');
  const emailed = chosenPartner.filter((h) => h.notifiesVendor);
  const mustPhone = chosenPartner.filter((h) => !h.notifiesVendor);
  const keeping = all.filter((h) => !selected.has(h.id));

  const canContinue = releaseOnly ? chosen.length > 0 : !!reason;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const bookingItemIds = chosenOurs.map((h) => h.id);
      const subRentalIds = chosenPartner.map((h) => h.id);
      const res = releaseOnly
        ? await fetch(`/api/jobs/${job.id}/holds`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookingItemIds, subRentalIds }),
          })
        : await fetch(`/api/jobs/${job.id}/mark-lost`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              reason,
              releaseBookingItemIds: bookingItemIds,
              releaseSubRentalIds: subRentalIds,
            }),
          });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) throw new Error((data as { error?: string }).error || 'Failed');

      // Who was actually emailed, and who we failed to reach — both shown,
      // because "the notice went" is the thing a human is trusting us for
      // and a partner we could not reach is the one they must act on.
      const payload = (data.release ?? data) as {
        partnerOutcomes?: { vendorName: string; vehicleName: string; notified: boolean; warning: string | null }[];
        releasedOurs?: number;
      };
      const outcomes = payload.partnerOutcomes ?? [];
      setResult({
        notified: outcomes
          .filter((o) => o.notified)
          .map((o) => `${o.vendorName} — ${o.vehicleName}`),
        warnings: outcomes.map((o) => o.warning).filter((x): x is string => !!x),
        ours: payload.releasedOurs ?? 0,
      });
      setWarnings(outcomes.map((o) => o.warning).filter((x): x is string => !!x));
      setBusy(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
      setBusy(false);
    }
  };

  const title = releaseOnly ? 'Release holds' : 'Mark job lost';

  const Row = ({ h }: { h: HeldUnit }) => (
    <label
      className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer border ${
        selected.has(h.id)
          ? 'border-lt-hairline bg-lt-inner'
          : 'border-transparent hover:bg-lt-inner'
      }`}
    >
      <input
        type="checkbox"
        checked={selected.has(h.id)}
        onChange={() => toggle(h.id)}
        className="mt-0.5 h-4 w-4 accent-amber-600"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-lt-fg font-medium">
          {h.quantity > 1 ? `${h.quantity}× ` : ''}{h.label}
          {h.vendorName && <span className="text-lt-fg2 font-normal"> · {h.vendorName}</span>}
        </span>
        <span className="block text-[12px] text-lt-fg3 mt-0.5">
          {fmtRange(h.startDate, h.endDate)} · {h.detail}
        </span>
      </span>
      {h.firm && (
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-chip-warn-bg text-chip-warn-fg">
          Firm
        </span>
      )}
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] supports-[max-height:85svh]:max-h-[85svh] overflow-y-auto bg-lt-card border border-lt-hairline rounded-xl shadow-2xl w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-lt-hairline">
          <h2 className="text-base font-semibold text-lt-fg">{title}</h2>
          <p className="text-[12px] text-lt-fg3 mt-0.5">
            {job.name} · {job.jobCode}{job.company.name ? ` · ${job.company.name}` : ''}
          </p>
        </div>

        {/* ── Step 2: confirm ─────────────────────────────────────────── */}
        {confirming ? (
          <div className="p-5 space-y-4">
            <p className="text-sm text-lt-fg">
              {chosen.length === 0
                ? 'No holds will be released.'
                : `Release ${chosen.length} hold${chosen.length === 1 ? '' : 's'}?`}
            </p>

            {chosen.length > 0 && (
              <ul className="space-y-1.5">
                {chosen.map((h) => (
                  <li key={h.id} className="text-[13px] text-lt-fg2">
                    <span className="text-lt-fg">
                      {h.quantity > 1 ? `${h.quantity}× ` : ''}{h.label}
                    </span>
                    {h.vendorName ? ` · ${h.vendorName}` : ''} · {fmtRange(h.startDate, h.endDate)}
                    {h.assignedUnits.length > 0 && (
                      <span className="text-lt-fg3"> · frees {h.assignedUnits.join(', ')}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {emailed.length > 0 && (
              <div className="rounded-lg px-3 py-2 bg-chip-neutral-bg text-chip-neutral-fg text-[12px]">
                <strong className="font-semibold">
                  {emailed.length} partner notice{emailed.length === 1 ? '' : 's'} will send:
                </strong>{' '}
                {Array.from(new Set(emailed.map((h) => h.vendorName))).join(', ')} — told the dates
                are released.
              </div>
            )}

            {mustPhone.length > 0 && (
              <div className="rounded-lg px-3 py-2 bg-chip-warn-bg text-chip-warn-fg text-[12px]">
                <strong className="font-semibold">Phone these partners yourself:</strong>{' '}
                {mustPhone.map((h) => `${h.vendorName} (${h.label})`).join(', ')} — no email on file,
                or they were never told we were holding it, so no notice goes out.
              </div>
            )}

            {keeping.length > 0 && (
              <div className="rounded-lg px-3 py-2 bg-lt-inner text-[12px] text-lt-fg2">
                <strong className="font-semibold text-lt-fg">Still held:</strong>{' '}
                {keeping.map((h) => h.label + (h.vendorName ? ` (${h.vendorName})` : '')).join(', ')}
              </div>
            )}

            {!releaseOnly && (
              <p className="text-[12px] text-lt-fg3">
                The job moves to Lost and open quotes close. Won orders are unchanged.
              </p>
            )}

            {result && (
              <div className="space-y-2">
                <div className="rounded-lg px-3 py-2 bg-chip-good-bg text-chip-good-fg text-[12px]">
                  <p className="font-semibold">
                    Done — {result.ours} of our hold{result.ours === 1 ? '' : 's'} released.
                  </p>
                  {result.notified.length > 0 ? (
                    <p className="mt-1">
                      Release email sent to: {result.notified.join('; ')}. Each one carries a
                      one-tap confirm; the job page shows who has acknowledged.
                    </p>
                  ) : (
                    <p className="mt-1">No partner emails were due on this one.</p>
                  )}
                </div>
                {warnings.length > 0 && (
                  <div className="rounded-lg px-3 py-2 bg-chip-bad-bg text-chip-bad-fg text-[12px] space-y-1">
                    <p className="font-semibold">Not everyone was told:</p>
                    {warnings.map((w, i) => <p key={i}>{w}</p>)}
                    <p className="pt-1">Follow these up by phone.</p>
                  </div>
                )}
              </div>
            )}
            {error && <p className="text-xs text-chip-bad-fg">{error}</p>}
          </div>
        ) : (
          /* ── Step 1: reason + what to release ──────────────────────── */
          <div className="p-5 space-y-4">
            {!releaseOnly && (
              <div>
                <p className="text-[11px] font-semibold text-lt-fg2 uppercase tracking-wide mb-2">
                  Why did we lose it?
                </p>
                <div className="space-y-1">
                  {LOST_REASON_CHOICES.map((c) => (
                    <label
                      key={c.value}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm ${
                        reason === c.value ? 'bg-lt-inner text-lt-fg' : 'text-lt-fg2 hover:bg-lt-inner'
                      }`}
                    >
                      <input
                        type="radio"
                        name="lost-reason"
                        checked={reason === c.value}
                        onChange={() => setReason(c.value)}
                        className="h-3.5 w-3.5 accent-amber-600"
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-baseline justify-between mb-2">
                <p className="text-[11px] font-semibold text-lt-fg2 uppercase tracking-wide">
                  Holds to release
                </p>
                {all.length > 0 && (
                  <button
                    onClick={() =>
                      setSelected(selected.size === all.length ? new Set() : new Set(all.map((h) => h.id)))
                    }
                    className="text-[12px] text-lt-fg2 hover:text-lt-fg underline"
                  >
                    {selected.size === all.length ? 'Clear all' : 'Select all'}
                  </button>
                )}
              </div>

              {loadingHolds ? (
                <p className="text-[13px] text-lt-fg3">Loading what this job is holding…</p>
              ) : all.length === 0 ? (
                <p className="text-[13px] text-lt-fg3">
                  Nothing is being held for this job — no fleet to hand back.
                </p>
              ) : (
                <div className="space-y-3">
                  {(holds?.ours.length ?? 0) > 0 && (
                    <div className="space-y-1">
                      <p className="text-[11px] text-lt-fg3 uppercase tracking-wide">Our fleet</p>
                      {holds!.ours.map((h) => <Row key={h.id} h={h} />)}
                    </div>
                  )}
                  {(holds?.partner.length ?? 0) > 0 && (
                    <div className="space-y-1">
                      <p className="text-[11px] text-lt-fg3 uppercase tracking-wide">
                        Partner units — releasing emails them
                      </p>
                      {holds!.partner.map((h) => <Row key={h.id} h={h} />)}
                    </div>
                  )}
                </div>
              )}
            </div>

            {error && <p className="text-xs text-chip-bad-fg">{error}</p>}
          </div>
        )}

        <div className="px-5 py-3 border-t border-lt-hairline flex items-center justify-end gap-2">
          {result ? (
            <button
              onClick={onMarked}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={confirming ? () => setConfirming(false) : onClose}
                disabled={busy}
                className="px-3 py-2 text-sm font-medium text-lt-fg2 hover:text-lt-fg disabled:opacity-50"
              >
                {confirming ? 'Back' : 'Cancel'}
              </button>
              <button
                onClick={confirming ? submit : () => setConfirming(true)}
                disabled={busy || loadingHolds || !canContinue}
                className={`px-4 py-2 text-white text-sm font-semibold rounded-lg disabled:opacity-50 ${
                  confirming ? 'bg-rose-600 hover:bg-rose-500' : 'bg-amber-600 hover:bg-amber-500'
                }`}
              >
                {busy
                  ? 'Working…'
                  : confirming
                    ? releaseOnly
                      ? `Release ${chosen.length}`
                      : 'Confirm — mark lost'
                    : 'Review'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
