/**
 * Carry a job's LCDW election onto its orders' money — and tell the
 * client the number moved.
 *
 * Wes, 2026-09-05, after Luis Salgado (Subplot, S260905-001) elected the
 * waiver in the job portal and approved the quote 24 seconds later: the
 * fee reached the order fifty minutes on, by hand, and nothing flagged
 * the changed total to the client. "Make sure the agent is prompted to
 * add LCDW to the quote, and make sure the updated quote is flagged to
 * the client."
 *
 * The election is a SIGNED acceptance of $24/day/vehicle (or a signed
 * refusal of it). There is no pricing judgment left for a human to make,
 * only arithmetic, so the fee is applied here rather than left as a
 * reminder — the action item ('lcdw-unapplied') stays as the backstop
 * for whatever this could not do: an order with no dates yet, a locked
 * order, an annual account's standing answer that was never a per-job
 * event, an order created after the election.
 *
 * ── Both directions ────────────────────────────────────────────────
 *
 * ACCEPTED adds the fee line to every live order on the job that has an
 * eligible vehicle. DECLINED removes it. A rep who put LCDW on the quote
 * hopefully and a client who then signs a declination have disagreed,
 * and the signed document wins — charging for a waiver the client has
 * refused in writing is the error this must never make.
 *
 * ── Telling the client ─────────────────────────────────────────────
 *
 * Every order whose money actually changed AND whose quote the client
 * has already seen gets the "Updated quote" email through
 * resendQuoteOnChange — the same sender the dock uses, HQ copied. Orders
 * past the quote stage, or never sent, are changed silently (the sender
 * refuses them on its own) and the outcome is reported so the team
 * notification can say so.
 *
 * Nothing here throws to the caller. The election is already recorded;
 * a pricing or email failure is reported, never allowed to fail the
 * client's submit.
 */

import type { LcdwDecision } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { applyLcdwToOrder, removeLcdwFromOrder } from '@/lib/orders/applyLcdw'
import { resendQuoteOnChange, type ResendOutcome } from '@/lib/orders/resendQuoteOnChange'

/** Orders whose money is gone from the live picture. */
const DEAD_ORDER_STATUSES = ['CANCELLED', 'CLOSED', 'INVOICED'] as const

export interface ElectionOrderOutcome {
  orderId: string
  orderNumber: string
  /** What happened to the fee line on this order. */
  result:
    | { kind: 'applied'; changeLine: string; total: number }
    | { kind: 'removed'; changeLine: string }
    | { kind: 'unchanged' }
    | { kind: 'refused'; reason: string }
  /** The client email, when one was attempted. */
  resend: ResendOutcome | null
}

export interface ElectionApplyOutcome {
  decision: LcdwDecision
  orders: ElectionOrderOutcome[]
  /** One-line summary for a notification or a log. */
  summary: string
}

export async function applyLcdwElectionToJobOrders(opts: {
  jobId: string
  decision: LcdwDecision
  /** Who recorded the election — stamped on the audit rows. */
  source: 'PORTAL_JOB' | 'PORTAL_BOOKING' | 'STAFF'
  recordedById?: string | null
}): Promise<ElectionApplyOutcome> {
  const { jobId, decision } = opts
  const orders = await prisma.order.findMany({
    where: { jobId, archivedAt: null, status: { notIn: [...DEAD_ORDER_STATUSES] } },
    select: { id: true, orderNumber: true },
    orderBy: { createdAt: 'asc' },
  })

  const outcomes: ElectionOrderOutcome[] = []
  for (const o of orders) {
    const entry: ElectionOrderOutcome = { orderId: o.id, orderNumber: o.orderNumber, result: { kind: 'unchanged' }, resend: null }
    try {
      if (decision === 'ACCEPTED') {
        const r = await applyLcdwToOrder(o.id)
        if (!r.ok) entry.result = { kind: 'refused', reason: r.reason }
        else if (!r.alreadyApplied) entry.result = { kind: 'applied', changeLine: r.changeLine, total: r.total }
      } else {
        const r = await removeLcdwFromOrder(o.id)
        if (!r.ok) entry.result = { kind: 'refused', reason: r.reason }
        else if (!r.alreadyRemoved) entry.result = { kind: 'removed', changeLine: r.changeLine }
      }
    } catch (err) {
      entry.result = { kind: 'refused', reason: err instanceof Error ? err.message : 'apply failed' }
    }

    if (entry.result.kind === 'applied' || entry.result.kind === 'removed') {
      const changeLine = entry.result.changeLine
      await prisma.auditLog
        .create({
          data: {
            action: decision === 'ACCEPTED' ? 'order.lcdw_applied_from_election' : 'order.lcdw_removed_from_election',
            entityType: 'Order',
            entityId: o.id,
            userId: opts.recordedById ?? null,
            oldValues: {},
            newValues: { jobId, decision, source: opts.source, change: changeLine },
          },
        })
        .catch((err) => console.error('[lcdw-apply] audit write failed', o.id, err))

      try {
        entry.resend = await resendQuoteOnChange({
          orderId: o.id,
          changes: [changeLine],
          reason: 'lcdw-election',
        })
      } catch (err) {
        entry.resend = { sent: false, reason: err instanceof Error ? err.message : 'the re-send failed' }
      }
    }
    outcomes.push(entry)
  }

  return { decision, orders: outcomes, summary: summarize(decision, outcomes) }
}

function summarize(decision: LcdwDecision, outcomes: ElectionOrderOutcome[]): string {
  if (outcomes.length === 0) return 'No live orders on the job — nothing to price yet.'
  const parts: string[] = []
  for (const o of outcomes) {
    const r = o.result
    const mail = o.resend ? (o.resend.sent ? `updated quote emailed to ${o.resend.to}` : `client NOT emailed (${o.resend.reason})`) : ''
    if (r.kind === 'applied') parts.push(`${o.orderNumber}: fee added, $${r.total.toFixed(2)}${mail ? ` — ${mail}` : ''}`)
    else if (r.kind === 'removed') parts.push(`${o.orderNumber}: fee removed${mail ? ` — ${mail}` : ''}`)
    else if (r.kind === 'refused') parts.push(`${o.orderNumber}: NOT ${decision === 'ACCEPTED' ? 'added' : 'removed'} — ${r.reason}`)
    else parts.push(`${o.orderNumber}: already ${decision === 'ACCEPTED' ? 'on' : 'off'} the order`)
  }
  return parts.join(' · ')
}
