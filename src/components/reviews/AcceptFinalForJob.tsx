'use client';

/**
 * "Accept as Final" for a review that has a job but no linked agreement —
 * the usual state of a redline uploaded at /tools/contract-review.
 *
 * Pick which of the job's orders carries the agreement, then one press links
 * the review to it and runs the normal accept (the client is emailed the
 * negotiated agreement to sign; the portal's Sign button returns). Two
 * existing-shaped calls, so a failure names its step.
 */

import { useEffect, useState } from 'react';

interface Candidate {
  orderId: string;
  orderNumber: string;
  status: string;
  agreementStatus: string;
}

export function AcceptFinalForJob({
  reviewId,
  onDone,
}: {
  reviewId: string;
  onDone: () => void;
}) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [orderId, setOrderId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const r = await fetch(`/api/tools/contract-review/${reviewId}/link-agreement`);
      const j = await r.json().catch(() => ({}));
      const list: Candidate[] = Array.isArray(j.candidates) ? j.candidates : [];
      setCandidates(list);
      // Prefer the order the client has already approved.
      const approved = list.find((c) => c.status !== 'DRAFT' && c.status !== 'QUOTE_SENT');
      setOrderId((approved ?? list[0])?.orderId ?? '');
    })();
  }, [reviewId]);

  const accept = async () => {
    if (!orderId) return;
    setBusy(true);
    setErr('');
    try {
      const link = await fetch(`/api/tools/contract-review/${reviewId}/link-agreement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      const lj = await link.json().catch(() => ({}));
      if (!link.ok) {
        setErr(lj.error || 'Could not link the review to that order.');
        return;
      }
      const res = await fetch(`/api/orders/${orderId}/contract-review/accept`, { method: 'POST' });
      const aj = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(`Linked to ${lj.orderNumber}, but accepting failed: ${aj.error || 'unknown error'}`);
        onDone();
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  };

  if (candidates === null) return null;

  return (
    <div className="bg-white border border-indigo-200 rounded-2xl p-4 space-y-3">
      <div className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">Accept as final</div>
      {candidates.length === 0 ? (
        <div className="text-[12px] text-gray-600">
          None of this job&rsquo;s orders has an unsigned rental agreement to accept this onto.
        </div>
      ) : (
        <>
          <div className="text-[11px] text-gray-500 max-w-xl">
            When the client has agreed the counter-proposal, accept it onto the order&rsquo;s agreement. They&rsquo;re
            emailed the negotiated agreement to sign, and the Sign button returns on their portal.
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {candidates.length > 1 && (
              <select
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                className="text-[12px] border border-gray-300 rounded-lg px-2 py-1.5 bg-white text-gray-800"
              >
                {candidates.map((c) => (
                  <option key={c.orderId} value={c.orderId}>
                    {c.orderNumber} · {c.status.replace(/_/g, ' ').toLowerCase()}
                  </option>
                ))}
              </select>
            )}
            {candidates.length === 1 && (
              <span className="text-[12px] text-gray-700">Order {candidates[0].orderNumber}</span>
            )}
            <button
              onClick={() => void accept()}
              disabled={busy || !orderId}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-200 disabled:text-gray-400 text-white text-[12px] font-bold rounded-xl"
            >
              {busy ? 'Accepting…' : 'Accept as Final'}
            </button>
          </div>
        </>
      )}
      {err && <div className="text-[11px] text-red-600">{err}</div>}
    </div>
  );
}
