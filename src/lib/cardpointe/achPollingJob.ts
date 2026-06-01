/**
 * ACH settlement polling job.
 *
 * Phase 6 commit 4 — dormant behind ACH_ENABLED. The job runs (per a
 * cron entry) over outstanding ACH payments in PENDING or SETTLED
 * state, calls CardPointe /inquire/<retref>/<mid>, runs each result
 * through mapAchInquireToPaymentState (the single mapping
 * chokepoint), and applies state transitions.
 *
 * Transitions:
 *   PENDING  → SETTLED   (gateway acknowledges file submission)
 *   PENDING  → CLEARED   (instant-clear path; rare for ACH but maps
 *                          for completeness)
 *   PENDING  → RETURNED  (bank rejected — NSF, closed account, etc.)
 *   PENDING  → FAILED    (gateway-level decline / void)
 *   SETTLED  → CLEARED   (clearing window passed; money is ours)
 *   SETTLED  → RETURNED  (bank reversed AFTER settle — rarer but
 *                          NACHA permits it for ~60d)
 *
 * Side effects:
 *   - CLEARED transition stamps clearedAt + settledAt (if not set),
 *     calls reconcileInvoiceTotals (now counts the payment), and
 *     maybeAdvanceOrderToClosed (RENTAL invoices only). This is the
 *     LINCHPIN — only here does an ACH payment ever count.
 *   - RETURNED transition stamps returnedAt + returnReason, removes
 *     the payment from the paid sum (reconcile excludes RETURNED),
 *     and calls maybeRegressOrderFromClosed in case the order had
 *     somehow already been closed.
 *   - SETTLED transition is informational — invoice still not paid,
 *     order still not closed. Stamps settledAt; the next poll will
 *     check for CLEARED or RETURNED.
 *   - PENDING (no movement) — logs the reason + leaves the row.
 *
 * Every transition writes an AuditLog row tagged 'payment.ach_poll_*'
 * carrying the gateway retref + the mapping decision's reason code +
 * confidence. Unverified-status decisions are flagged distinctly so
 * an operator dashboard can surface them for manual review later.
 *
 * Idempotent: re-running the job on the same retref is safe. A
 * payment that already advanced to CLEARED/RETURNED/FAILED is
 * filtered out of the query at the top.
 */

import type { Payment, PaymentStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { inquireByRetref } from './client'
import { mapAchInquireToPaymentState } from './achStatusMapping'
import {
  reconcileInvoiceTotals,
  maybeAdvanceOrderToClosed,
  maybeRegressOrderFromClosed,
} from '@/lib/invoices/recordPayment'

const POLLABLE_STATES: PaymentStatus[] = ['PENDING', 'SETTLED']

export interface PollAchPaymentsResult {
  scanned: number
  movedToSettled: number
  movedToCleared: number
  movedToReturned: number
  movedToFailed: number
  unchanged: number
  errors: number
  /** Diagnostic detail for operator review. Empty in normal
   *  steady-state; non-empty when something needs eyeballs. */
  notes: Array<{
    paymentId: string
    retref: string
    decision: string
    confidence: 'verified' | 'unverified'
  }>
}

export async function pollAchPayments(opts: {
  /** Override the default "anything ≥ 30 min old since lastChecked"
   *  cadence — useful for tests. Defaults to 30 minutes. */
  minAgeMs?: number
  /** Cap the batch per run. */
  limit?: number
} = {}): Promise<PollAchPaymentsResult> {
  const minAgeMs = opts.minAgeMs ?? 30 * 60_000
  const limit = opts.limit ?? 100

  // Phase 6 LINCHPIN-relevant scan: only ACH payments in non-terminal
  // states with a gateway retref to inquire against. Voided rows are
  // already terminal — never re-poll. CLEARED / RETURNED / FAILED
  // already settled their accounting; not in the scan.
  const candidates = await prisma.payment.findMany({
    where: {
      method: 'ACH',
      status: { in: POLLABLE_STATES },
      voidedAt: null,
      gatewayRefId: { not: null },
      // Don't hammer the gateway — only re-check rows that have aged
      // past the minimum interval. Payment.createdAt is the closest
      // proxy we have to "last touched" since the model intentionally
      // doesn't carry an updatedAt column (audit-log-driven design).
      // SETTLED transitions stamp settledAt, so for already-SETTLED
      // rows we also accept settledAt-based aging — gives the
      // settle→clear window the polling cadence it needs.
      OR: [
        { createdAt: { lte: new Date(Date.now() - minAgeMs) } },
        { settledAt: { lte: new Date(Date.now() - minAgeMs) } },
      ],
    },
    select: {
      id: true,
      status: true,
      gatewayRefId: true,
      invoiceId: true,
      settledAt: true,
    },
    take: limit,
    orderBy: { createdAt: 'asc' },
  })

  const result: PollAchPaymentsResult = {
    scanned: candidates.length,
    movedToSettled: 0,
    movedToCleared: 0,
    movedToReturned: 0,
    movedToFailed: 0,
    unchanged: 0,
    errors: 0,
    notes: [],
  }

  for (const c of candidates) {
    const retref = c.gatewayRefId
    if (!retref) continue

    try {
      const snap = await inquireByRetref(retref)
      const decision = mapAchInquireToPaymentState(snap)

      // Don't issue spurious writes if nothing's actually changing.
      // The mapper's "PENDING" target is a no-op for already-PENDING
      // payments. Same for SETTLED → SETTLED.
      if (decision.target === c.status) {
        result.unchanged += 1
        if (decision.confidence === 'unverified') {
          result.notes.push({
            paymentId: c.id,
            retref,
            decision: decision.reason,
            confidence: decision.confidence,
          })
        }
        continue
      }

      await applyTransition(c.id, c.status, decision.target, decision.reason, decision.confidence)

      switch (decision.target) {
        case 'SETTLED':
          result.movedToSettled += 1
          break
        case 'CLEARED':
          result.movedToCleared += 1
          break
        case 'RETURNED':
          result.movedToReturned += 1
          break
        case 'FAILED':
          result.movedToFailed += 1
          break
        case 'PENDING':
          // Defensive — shouldn't happen given the equality check
          // above, but if the mapper ever returns PENDING for a
          // SETTLED row (impossible regression direction) we treat
          // it as no-op.
          result.unchanged += 1
          break
      }
    } catch (err) {
      result.errors += 1
      console.error('[ach-poll] error polling retref=%s:', retref, err)
    }
  }

  return result
}

// ─── State-transition helper ──────────────────────────────────────

/**
 * Atomically moves a Payment between non-terminal states. Stamps the
 * matching timestamp (settledAt / clearedAt / returnedAt), runs
 * reconcileInvoiceTotals + maybeAdvance/Regress, writes the audit
 * trail.
 *
 * Single source of truth for "an ACH payment changed state from a
 * gateway poll." Routes do not call this directly — only the
 * polling job. Operator-initiated transitions (manual reconciliation
 * dashboard, future work) would go through their own helper.
 */
async function applyTransition(
  paymentId: string,
  fromStatus: PaymentStatus,
  toStatus: 'PENDING' | 'SETTLED' | 'CLEARED' | 'RETURNED' | 'FAILED',
  reason: string,
  confidence: 'verified' | 'unverified',
): Promise<void> {
  // PENDING target = no DB change (caller already filtered that
  // case). Defensive guard against accidental writes.
  if (toStatus === 'PENDING') return

  const now = new Date()

  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        invoiceId: true,
        settledAt: true,
        status: true,
      },
    })
    if (!payment) return
    // Defense in depth — another worker may have raced us. Refuse to
    // transition out of a terminal state.
    if (payment.status === 'CLEARED' || payment.status === 'RETURNED' || payment.status === 'FAILED') {
      return
    }

    const data: Record<string, unknown> = { status: toStatus }

    if (toStatus === 'SETTLED' && !payment.settledAt) {
      data.settledAt = now
    }
    if (toStatus === 'CLEARED') {
      // Stamp settledAt too if it wasn't already — when an ACH
      // instant-clears (rare), the gateway snapshot skips SETTLED
      // entirely. We backfill the timestamp so the lifecycle reads
      // coherently.
      if (!payment.settledAt) data.settledAt = now
      data.clearedAt = now
    }
    if (toStatus === 'RETURNED') {
      data.returnedAt = now
      data.returnReason = reason.replace(/^bank_return:/, '').slice(0, 200)
    }

    await tx.payment.update({ where: { id: paymentId }, data })

    // LINCHPIN: only CLEARED counts toward paid (see reconcile).
    // Trigger reconcile + maybeAdvance on CLEARED.
    // Trigger reconcile + maybeRegress on RETURNED (the row drops out
    // of the SUM, which may pull the invoice off PAID — if so the
    // order can no longer stay CLOSED on this invoice's basis).
    if (toStatus === 'CLEARED') {
      const updated = await reconcileInvoiceTotals(tx, payment.invoiceId)
      await maybeAdvanceOrderToClosed(tx, payment.invoiceId, updated)
    } else if (toStatus === 'RETURNED') {
      const wasInvoicePaid = await tx.invoice
        .findUnique({ where: { id: payment.invoiceId }, select: { status: true } })
        .then((inv) => inv?.status === 'PAID')
      const updated = await reconcileInvoiceTotals(tx, payment.invoiceId)
      await maybeRegressOrderFromClosed(tx, payment.invoiceId, updated, wasInvoicePaid)
    }

    await tx.auditLog.create({
      data: {
        action:
          toStatus === 'CLEARED'  ? 'payment.ach_poll_cleared'  :
          toStatus === 'SETTLED'  ? 'payment.ach_poll_settled'  :
          toStatus === 'RETURNED' ? 'payment.ach_poll_returned' :
          toStatus === 'FAILED'   ? 'payment.ach_poll_failed'   :
                                     'payment.ach_poll_other',
        entityType: 'Payment',
        entityId: payment.id,
        oldValues: { status: fromStatus },
        newValues: {
          status: toStatus,
          reason,
          confidence,
          // Flag for the future operator-review surface — anything
          // unverified should land in front of an operator before
          // they trust the new state. Today we just persist the
          // flag in the audit row.
          needsReview: confidence === 'unverified',
        },
      },
    })
  })
}
