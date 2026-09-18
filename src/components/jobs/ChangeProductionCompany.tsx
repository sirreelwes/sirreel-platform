'use client';

/**
 * Move a job to a different production company, and clean up after it.
 *
 * The change is never just a field edit. The job's orders bill against the
 * company, and any agreement the client already signed named the OLD one — a
 * signature against the wrong entity is not a contract with the company that
 * is actually renting. So this panel does the move and then, in the same
 * place, offers to re-issue what the move invalidated. Splitting those into
 * two screens is how a wrong-entity agreement stays out in the world.
 *
 * Rendered inline (not a modal) so it can sit inside whichever surface the
 * problem surfaced on: the COI review desk, where a named-insured mismatch is
 * discovered, and the job header, where somebody who already knows the
 * company is wrong goes to fix it.
 */

import { useState } from 'react';
import { CompanyPicker } from '@/components/orders/CompanyPicker';

interface DiscountConflict {
  orderId: string;
  orderNumber: string;
  departmentKey: string;
  /** The new account's deal, e.g. "30% off Production supply orders". */
  deal: string;
  /** What is on the order instead. */
  onOrder: string;
}

interface StaleAgreement {
  orderId: string;
  orderNumber: string;
  contractType: string;
  status: string;
  signedAt: string | null;
  signerName: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ChangeProductionCompany({
  jobId,
  currentCompanyName,
  suggestedName,
  onChanged,
}: {
  jobId: string;
  currentCompanyName: string | null;
  /** Pre-fills the create-new field — e.g. the named insured off the COI. */
  suggestedName?: string | null;
  /** Fired after the move and after each re-issue, so the parent can reload. */
  onChanged?: () => void;
}) {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [newCompanyName, setNewCompanyName] = useState(suggestedName || '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Populated by the move: what the move just invalidated. Null until then —
  // distinct from an empty array, which means "nothing was signed".
  const [staleAgreements, setStaleAgreements] = useState<StaleAgreement[] | null>(null);
  // Department deals the new account has that could NOT be seeded, because
  // a discount row was already sitting in that department. Nothing here can
  // tell the old account's row from a rep's own, so a person settles it.
  const [discountConflicts, setDiscountConflicts] = useState<DiscountConflict[]>([]);
  const [priorCompanyName, setPriorCompanyName] = useState<string | null>(null);
  const [reissueReason, setReissueReason] = useState('');

  const move = async () => {
    if (!companyId && !newCompanyName.trim()) {
      setError('Pick an existing company or type the correct name.');
      return;
    }
    setBusy('MOVE');
    setError(null);
    setFlash(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/company`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(companyId ? { companyId } : { companyName: newCompanyName.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok) {
        setError(d?.error || 'Could not change the production company.');
        return;
      }
      setPriorCompanyName(d.previousCompanyName ?? null);
      setStaleAgreements(d.staleAgreements || []);
      setDiscountConflicts(d.discountConflicts || []);
      setReissueReason(
        `The agreement was signed under ${d.previousCompanyName || 'the previous company'}; this rental is under ${d.company.name}.`,
      );
      const seeded = (d.discountsSeeded || []).length;
      const moved = [
        d.ordersMoved ? `${d.ordersMoved} order${d.ordersMoved === 1 ? '' : 's'}` : '',
        d.bookingsMoved ? `${d.bookingsMoved} booking${d.bookingsMoved === 1 ? '' : 's'}` : '',
        d.coisMoved ? `${d.coisMoved} certificate${d.coisMoved === 1 ? '' : 's'}` : '',
        // The new account's terms following the job is the half nobody can
        // see from the outside — say it happened.
        seeded ? `${seeded} standing discount${seeded === 1 ? '' : 's'} applied` : '',
      ].filter(Boolean);
      setFlash(`Moved to ${d.company.name}${moved.length ? ` · ${moved.join(', ')} re-pointed` : ''}.`);
      onChanged?.();
    } catch {
      setError('Could not change the production company.');
    } finally {
      setBusy(null);
    }
  };

  const reissue = async (a: StaleAgreement) => {
    if (!reissueReason.trim()) {
      setError('Say why it is being re-issued — it becomes the audit record.');
      return;
    }
    setBusy(`REISSUE:${a.orderId}`);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${a.orderId}/agreement/reissue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: reissueReason.trim(),
          contractType: a.contractType,
          priorCompanyName,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok) {
        setError(d?.error || 'Could not re-issue that agreement.');
        return;
      }
      setStaleAgreements((prev) => (prev || []).filter((x) => x.orderId !== a.orderId));
      setFlash(
        d.needsStageRegeneration
          ? `${a.orderNumber}: signature cleared — regenerate the stage contract before it can be signed.`
          : d.emailed
            ? `${a.orderNumber}: re-issued and emailed to the client to sign.`
            : `${a.orderNumber}: re-issued. ${d.emailError || 'Send the portal link manually.'}`,
      );
      onChanged?.();
    } catch {
      setError('Could not re-issue that agreement.');
    } finally {
      setBusy(null);
    }
  };

  const moved = staleAgreements !== null;

  return (
    <div className="space-y-3">
      {!moved && (
        <>
          <p className="text-[12px] text-zinc-300">
            Moves this job and its orders to the company that is actually renting
            {currentCompanyName ? <> — currently <span className="text-white">{currentCompanyName}</span></> : null}.
          </p>
          <div>
            <label className="block text-[11px] text-zinc-400 mb-1">Existing company</label>
            <CompanyPicker
              value={companyId}
              selectedName={companyName}
              onChange={(id, name) => {
                setCompanyId(id || null);
                setCompanyName(name || null);
              }}
            />
          </div>
          {!companyId && (
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">…or create a new one</label>
              <input
                value={newCompanyName}
                onChange={(e) => setNewCompanyName(e.target.value)}
                placeholder="Production company name"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500"
              />
              <p className="mt-1 text-[11px] text-zinc-500">
                An exact name match is reused rather than duplicated.
              </p>
            </div>
          )}
          <button
            onClick={move}
            disabled={busy === 'MOVE'}
            className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-[13px] font-semibold rounded-lg py-2"
          >
            {busy === 'MOVE' ? 'Moving…' : 'Change production company'}
          </button>
        </>
      )}

      {/* Only after the move: a deal the new account has that this order
          already had a row in the way of. Amber, not rose — nothing is
          broken, but the figure on the order is the old account's. */}
      {moved && discountConflicts.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-3.5 py-3 space-y-2">
          <div className="text-[13px] font-semibold text-amber-200">
            Their discount could not be applied — a row is already there
          </div>
          {discountConflicts.map((c) => (
            <div key={`${c.orderId}:${c.departmentKey}`} className="text-[12px] text-zinc-300">
              <span className="text-white">{c.orderNumber}</span>
              <span className="text-zinc-500"> · {c.deal} · on the order as {c.onOrder}</span>
            </div>
          ))}
          <p className="text-[11px] text-zinc-500">
            The existing row was left alone — it may be a discount someone gave on purpose.
            Change it on the order&apos;s Discounts panel if the new account&apos;s deal should win.
          </p>
        </div>
      )}

      {/* Only after the move: the paper it invalidated. */}
      {moved && staleAgreements.length > 0 && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/5 px-3.5 py-3 space-y-2.5">
          <div className="text-[13px] font-semibold text-rose-200">
            Signed under the old company — re-issue to the new one
          </div>
          <textarea
            value={reissueReason}
            onChange={(e) => setReissueReason(e.target.value)}
            rows={2}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-[12px] text-white"
            placeholder="Why it is being re-issued (goes to the client and into the audit record)"
          />
          {staleAgreements.map((a) => (
            <div key={`${a.orderId}:${a.contractType}`} className="flex items-center gap-2">
              <div className="min-w-0 flex-1 text-[12px] text-zinc-300">
                <span className="text-white">{a.orderNumber}</span>
                <span className="text-zinc-500">
                  {' '}
                  · {a.contractType === 'STAGE_CONTRACT' ? 'Stage contract' : 'Rental agreement'} · signed{' '}
                  {fmtDate(a.signedAt)}
                  {a.signerName ? ` by ${a.signerName}` : ''}
                </span>
              </div>
              <button
                onClick={() => reissue(a)}
                disabled={busy === `REISSUE:${a.orderId}`}
                className="shrink-0 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-rose-200 text-[12px] font-semibold rounded-lg px-2.5 py-1.5"
              >
                {busy === `REISSUE:${a.orderId}` ? 'Re-issuing…' : 'Re-issue & email'}
              </button>
            </div>
          ))}
          <p className="text-[11px] text-zinc-500">
            The old signature is kept as an audit record; the client is asked to sign the corrected
            agreement.
          </p>
        </div>
      )}

      {moved && staleAgreements.length === 0 && (
        <p className="text-[12px] text-zinc-400">
          Nothing had been signed under the old company, so there is no agreement to re-issue.
        </p>
      )}

      {error && <div className="text-[12px] text-rose-300">{error}</div>}
      {flash && <div className="text-[12px] text-emerald-300">{flash}</div>}
    </div>
  );
}
