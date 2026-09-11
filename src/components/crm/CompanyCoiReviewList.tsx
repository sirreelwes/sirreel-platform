/**
 * The account's certificates on /crm/portals, inside an opened company row.
 *
 * Wes 2026-09-11, on the Happy Place row: "if the COI needs approval why
 * can't i see that on the portal?" The row's chip read "COI through May
 * 2027" off Company.coiExpiry while a second copy of the certificate sat
 * PENDING — nothing on the Portals tab looked at the certificates at all.
 *
 * Awaiting approval first, each with the review desk (CoiReviewLauncher →
 * CoiReviewModal, unchanged). A pending row that is byte-for-byte the size
 * of an approved one with the same insured and expiry says so — Oliver
 * uploaded Birdie's certificate twice, two minutes apart, and approved only
 * the second — so the reviewer rejects the copy instead of re-reading it.
 */

import { CoiReviewLauncher } from '@/components/coi/CoiReviewLauncher'
import { COI_DOCUMENT_KIND_LABEL } from '@/lib/coi/coverageKind'
import type { StaffAccountCoi, StaffAccountCoiState } from '@/lib/portal/companyPortalCois'

function fmt(d: Date | null): string {
  if (!d) return 'no expiry read'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function Row({ c, review }: { c: StaffAccountCoi; review: boolean }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-lt-fg truncate max-w-full">{c.namedInsured || c.filename}</span>
          {c.kind === 'WORKERS_COMP' && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-chip-neutral-bg text-chip-neutral-fg">
              {COI_DOCUMENT_KIND_LABEL.WORKERS_COMP}
            </span>
          )}
          {review && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-chip-warn-bg text-chip-warn-fg">
              {c.humanDecision === 'COUNTERED' ? 'Countered — awaiting approval' : 'Awaiting approval'}
            </span>
          )}
        </div>
        <div className="text-xs text-lt-fg2 mt-0.5">
          {c.filename} · expires {fmt(c.policyExpiry)}
          {c.jobCode ? ` · sent for ${c.jobCode}` : ' · account-level'}
          {c.uploadedBy ? ` · ${c.uploadedBy}` : ''} · filed {fmt(c.createdAt)}
        </div>
        {c.duplicateOf && (
          <div className={`text-xs mt-0.5 ${review ? 'text-chip-warn-fg' : 'text-lt-fg3'}`}>
            {review
              ? `Same file as the approved ${c.duplicateOf} — likely a duplicate upload; reject it.`
              : `Same file as ${c.duplicateOf}, also approved — a duplicate upload. The client sees it once.`}
          </div>
        )}
      </div>
      {review && (
        <div className="shrink-0 pt-0.5">
          <CoiReviewLauncher coiId={c.id} />
        </div>
      )}
    </li>
  )
}

export function CompanyCoiReviewList({ state }: { state: StaffAccountCoiState }) {
  if (state.awaiting.length === 0 && state.approved.length === 0) return null
  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl p-4">
      <div className="text-sm font-semibold text-lt-fg">Certificates of insurance</div>
      <p className="text-xs text-lt-fg2 mt-0.5">
        Current certificates on the account. Approved, dated certificates carry forward to every show they cover;
        one awaiting approval covers nothing yet.
      </p>
      <ul className="mt-2 divide-y divide-lt-hairline">
        {state.awaiting.map((c) => (
          <Row key={c.id} c={c} review />
        ))}
        {state.approved.map((c) => (
          <Row key={c.id} c={c} review={false} />
        ))}
      </ul>
    </div>
  )
}
