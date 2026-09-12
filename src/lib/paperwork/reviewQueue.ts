/**
 * The ONE answer to "what client paperwork is still waiting on us".
 *
 * Wes, 2026-09-11: the Paperwork tab should carry an alert when there are
 * COIs to review or client redlines to rule on — and the things in that
 * queue that need nothing (a resubmitted certificate superseding an older
 * one, a document handled over the phone) should be skippable so they stop
 * ringing the bell.
 *
 * Two callers, one derivation: the nav badge (/api/paperwork/review-queue)
 * and the Recent submissions feed (/api/paperwork/submissions). They were
 * never allowed to drift — a badge that says 4 over a page that shows 3 is
 * worse than no badge at all.
 *
 * What counts:
 *  - COI       — never ruled on (PENDING), or carrying a named-insured
 *                mismatch against the production company. The mismatch is
 *                computed on read (src/lib/coi/insuredMatch.ts), so a COI
 *                that was approved months ago can re-enter the queue when
 *                the job's company is corrected.
 *  - CONTRACT_REVIEW — a client redline sitting at PENDING on the review
 *                desk (/tools/contract-review/[id]).
 *  - REDLINE   — the legacy portal path (PaperworkRequest.contract_redline_*),
 *                status 'pending_review'. Zero rows today; kept because the
 *                portal route still writes it.
 *
 * A SKIP is not a decision. It writes a PaperworkDismissal and nothing
 * else — the COI stays PENDING, so the job readiness rollup, the hold
 * firmness gate and the client's own paperwork page keep saying exactly
 * what they said before. Only this queue stops counting it.
 */

import { prisma } from '@/lib/prisma'
import { evaluateInsuredMatch } from '@/lib/coi/insuredMatch'
import { DISMISS_REASONS } from '@/lib/paperwork/reviewQueueClient'

export type PaperworkReviewKind = 'COI' | 'CONTRACT_REVIEW' | 'REDLINE'

export const PAPERWORK_REVIEW_KINDS: PaperworkReviewKind[] = ['COI', 'CONTRACT_REVIEW', 'REDLINE']

export { DISMISS_REASONS } from '@/lib/paperwork/reviewQueueClient'

export function isReviewKind(v: unknown): v is PaperworkReviewKind {
  return typeof v === 'string' && (PAPERWORK_REVIEW_KINDS as string[]).includes(v)
}

export function dismissalKey(kind: string, sourceId: string): string {
  return `${kind}:${sourceId}`
}

export interface DismissalInfo {
  at: string
  by: string | null
  reason: string | null
  note: string | null
}

/**
 * Every skip on file, keyed `KIND:sourceId`. One query — the table holds
 * one row per skipped document and is expected to stay small.
 */
export async function loadDismissals(): Promise<Map<string, DismissalInfo>> {
  const rows = await prisma.paperworkDismissal.findMany({
    select: {
      kind: true,
      sourceId: true,
      reason: true,
      note: true,
      createdAt: true,
      dismissedBy: { select: { name: true } },
    },
  })
  return new Map(
    rows.map((r) => [
      dismissalKey(r.kind, r.sourceId),
      {
        at: r.createdAt.toISOString(),
        by: r.dismissedBy?.name ?? null,
        reason: r.reason,
        note: r.note,
      },
    ]),
  )
}

/**
 * A certificate the queue is still asking about — ignoring dismissals,
 * which are applied by the caller.
 *
 * Same rule the feed has drawn since the review desk shipped: no human
 * verdict yet, or a finding stated on the row. COUNTERED ("we asked the
 * client to fix it") is deliberately NOT here — the ball is theirs.
 */
export function coiNeedsReview(humanDecision: string, flagged: boolean): boolean {
  return humanDecision === 'PENDING' || flagged
}

export interface ReviewQueueCounts {
  total: number
  coi: number
  contractReview: number
  redline: number
}

/**
 * The badge number. Counts the whole backlog, not a recent window — the
 * feed that renders it guarantees every counted row is reachable, so a
 * number here is always something a human can act on or skip.
 */
export async function countPaperworkReviewQueue(): Promise<ReviewQueueCounts> {
  const [cois, contractReviews, redlines, dismissals] = await Promise.all([
    // Capped: the whole table is read because the insured-match verdict is
    // computed, not stored. ~110 rows today; the cap is a guard, not a page.
    prisma.coiCheck.findMany({
      where: { deletedAt: null },
      take: 2000,
      select: {
        id: true,
        humanDecision: true,
        namedInsured: true,
        job: { select: { name: true, company: { select: { name: true } } } },
        company: { select: { name: true } },
      },
    }),
    prisma.contractReview.findMany({
      where: { deletedAt: null, humanDecision: 'PENDING' },
      take: 2000,
      select: { id: true },
    }),
    prisma.paperworkRequest.findMany({
      where: { contract_redline_status: 'pending_review' },
      take: 2000,
      select: { id: true },
    }),
    loadDismissals(),
  ])

  const live = (kind: PaperworkReviewKind, id: string) => !dismissals.has(dismissalKey(kind, id))

  const coi = cois.filter((c) => {
    if (!live('COI', c.id)) return false
    const match = evaluateInsuredMatch(c.namedInsured, [
      c.job?.company?.name,
      c.company?.name,
      c.job?.name,
    ])
    return coiNeedsReview(c.humanDecision, match.needsAttention)
  }).length

  const contractReview = contractReviews.filter((r) => live('CONTRACT_REVIEW', r.id)).length
  const redline = redlines.filter((r) => live('REDLINE', r.id)).length

  return { total: coi + contractReview + redline, coi, contractReview, redline }
}
