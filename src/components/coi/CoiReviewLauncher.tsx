'use client';

/**
 * "Review" affordance for a COI row on a list page.
 *
 * The review desk lived only on the job page, so a certificate with no job —
 * exactly what the company-scoped COI link produces — had NO surface anywhere
 * that could approve it. It sat PENDING forever, and since carry-forward
 * requires APPROVED (see lib/coi/companyCoi.ts), an annual certificate
 * dropped at the company level would never actually reach a single job.
 *
 * Thin on purpose: the desk itself is CoiReviewModal, unchanged. This only
 * opens it from a row and refreshes the list afterwards.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CoiReviewModal } from './CoiReviewModal';

export function CoiReviewLauncher({
  coiId,
  label = 'Review',
}: {
  coiId: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-lt-fg hover:text-black text-xs font-semibold"
      >
        {label}
      </button>
      {open && (
        <CoiReviewModal
          coiId={coiId}
          onClose={() => setOpen(false)}
          // A decision changes the badge on this row (and, for an annual
          // certificate, whether it reaches any job at all) — so the list has
          // to re-read rather than keep showing the pre-decision state.
          onChanged={() => router.refresh()}
        />
      )}
    </>
  );
}
