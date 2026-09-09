/**
 * "Is this job papered?" — ONE derivation, for every surface that asks.
 *
 * ── The bug this exists to end (Wes, 2026-09-09) ────────────────────────────
 * SR-JOB-0294 read `Missing: Agreement` on the /jobs tile and `On file` on the
 * job page, one click later. Two orders; the signature lived on one of them.
 *
 *   - The tile rolled every live order up and demanded a signed-or-covered row
 *     PER ORDER (`rows.length >= liveOrderCount`), so the sibling order — which
 *     had no SignedAgreement row at all, having never been released — dragged
 *     the job to PARTIAL and pinned a red chip on it forever.
 *   - The job page called `.find()` on the flattened rows and read the FIRST
 *     one alone. It happened to hit the signed row and said On file. Had the
 *     orders sorted the other way it would have said Pending — the page was
 *     right by luck, not by rule.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * The rental agreement renders **Job #**, never an order number, and its
 * clauses are terms of business rather than a description of what shipped: the
 * signature papers the JOB (see lib/orders/agreementCoverage, which is the
 * async, DB-stamping half of this same idea). So an order is SATISFIED when:
 *
 *   1. it carries its own signature (isSignedAgreementStatus), OR
 *   2. its row is stamped `coveredByAgreementId` (applyJobCoverage got there), OR
 *   3. a SIBLING order on the same job AND same company carries a signature —
 *      whether or not this order has a row of its own.
 *
 * (3) is the fix. `applyJobCoverage` can only stamp a row that already exists
 * (`if (!own) return null`), so an order that never had an agreement generated
 * is unreachable by the stamp while still counting toward the "one row per
 * order" test. Deriving the same answer on read closes that hole without a
 * backfill, and keeps working for orders attached after the client signed.
 *
 * The same-company condition mirrors `findJobCoverage`: a job's company can be
 * corrected after a COI mismatch (PATCH /api/jobs/[id]/company moves job +
 * orders together), and a signature made under the previous entity must not
 * silently paper an order booked under the new one.
 *
 * Coverage is NOT a signature. It answers exactly one question — "do we still
 * need to ask this client for something?" Surfaces that render a signed COPY
 * must keep reading the row's own status.
 */

import { isSignedAgreementStatus } from '@/lib/portal/agreementStatus'

export type AgreementRollupState = 'NONE' | 'DRAFT' | 'SENT' | 'PARTIAL' | 'SIGNED'

/** Pre-release states — rendered, but never sent to the client. */
const PRE_RELEASE_STATES = ['PORTAL_GENERATED']

export interface AgreementRowInput {
  status: string
  coveredByAgreementId?: string | null
}

export interface AgreementOrderInput {
  id: string
  /** REQUIRED, not optional: a caller that forgets it silently loses the
   *  sibling-coverage rule and the false "Missing: Agreement" comes back.
   *  Null is a real answer (covered by nothing). */
  companyId: string | null
  /** This order's agreement rows FOR THE ONE contract type being rolled up. */
  rows: AgreementRowInput[]
}

export interface AgreementRollup {
  state: AgreementRollupState
  /** Orders satisfied, of `total`. Not a count of signatures. */
  count: number
  total: number
}

/**
 * Roll one contract type up across a job's live (non-cancelled) orders.
 * Callers filter rows by contractType and handle on-file/annual masters
 * themselves — an addendum covers the job outright, before any of this.
 */
export function rollupJobAgreement(orders: AgreementOrderInput[]): AgreementRollup {
  if (orders.length === 0) return { state: 'NONE', count: 0, total: 0 }

  // Companies with a real signature somewhere on this job.
  const signedCompanies = new Set<string>()
  for (const o of orders) {
    if (o.companyId && o.rows.some((r) => isSignedAgreementStatus(r.status))) {
      signedCompanies.add(o.companyId)
    }
  }

  const satisfied = orders.filter(
    (o) =>
      o.rows.some((r) => isSignedAgreementStatus(r.status) || !!r.coveredByAgreementId) ||
      (!!o.companyId && signedCompanies.has(o.companyId)),
  ).length

  if (satisfied === orders.length) return { state: 'SIGNED', count: satisfied, total: orders.length }

  const rows = orders.flatMap((o) => o.rows)
  // Nothing anywhere on the job — not a deficiency, just a job that has not
  // reached paperwork yet. Distinct from PARTIAL, which means someone is owed.
  if (rows.length === 0) return { state: 'NONE', count: 0, total: orders.length }

  if (satisfied > 0) return { state: 'PARTIAL', count: satisfied, total: orders.length }

  const allPreRelease = rows.every((r) => PRE_RELEASE_STATES.includes(r.status))
  return { state: allPreRelease ? 'DRAFT' : 'SENT', count: 0, total: orders.length }
}

/** Convenience: group a job's orders by contract type in one pass. */
export function ordersForContractType<
  R extends AgreementRowInput & { contractType: string },
  T extends { id: string; companyId: string | null; signedAgreements: R[] },
>(orders: T[], contractType: string): AgreementOrderInput[] {
  return orders.map((o) => ({
    id: o.id,
    companyId: o.companyId,
    rows: o.signedAgreements.filter((a) => a.contractType === contractType),
  }))
}
