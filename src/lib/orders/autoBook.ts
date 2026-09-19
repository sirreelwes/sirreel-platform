/**
 * Auto-book — the paperwork IS the booking.
 *
 * Wes, 2026-09-19: "when they've submitted a rental agreement and a COI,
 * it needs to auto-switch to booked, because essentially we treat it the
 * same anyway. I hate seeing jobs that have wrapped that show that they
 * were never booked."
 *
 * He is right about the treatment. A signed agreement plus an approved
 * certificate is what the yard, the invoice and the holds all key off;
 * BOOKED was the only thing still waiting for a human to click a button
 * that told nobody anything new. Orders reached their pickup day, went
 * out, came back and got invoiced while `Order.status` still read
 * QUOTE_SENT — 20 of them on the morning this was written, 10 already in
 * the past. This module closes that gap by running the SAME bookOrder()
 * the button runs, from the moment the last piece of paper lands.
 *
 * ── The rule ───────────────────────────────────────────────────────────
 * An order auto-books when ALL of:
 *   1. status is QUOTE_SENT or APPROVED. Never DRAFT — a draft's total is
 *      half-built and nobody has seen it. (mark-booked allows DRAFT
 *      because a HUMAN owns that number; nothing automatic should.)
 *   2. the COI is in — full certificate, human-approved, in date, in
 *      scope (lib/coi/coiState via clientPaperworkIn).
 *   3. the rental agreement is in — this order's own signature, a sibling
 *      order's on the same job, or the company's annual master.
 *   4. the client actually said yes to THIS order's money. Their own
 *      signature is that yes; so is status APPROVED. What this rules out
 *      is a second quote on a papered job booking itself off a sibling's
 *      signature while the client is still deciding — see `clientSaidYes`.
 *   5. the gates the manual button enforces all pass: unresolved
 *      shoot-days claims, the partner floor, an unsigned partner.
 *      Auto-book is never laxer than the human path; where a human is
 *      allowed to override (the unsigned partner), automation is not.
 *
 * The CARD is deliberately NOT required. Wes named two documents, and the
 * card already has its own gate at the point it matters — no card, no
 * keys (lib/orders/canPickupConfirm). Requiring it here would have left
 * exactly the wrapped-job-never-booked rows he is complaining about.
 *
 * ── What it sends ──────────────────────────────────────────────────────
 * Whatever the "Book it" button sends, because it is the same call: the
 * BOOKING_WELCOME email and the partners' "it's a go". With one carve-out
 * — an order whose PICKUP DAY HAS PASSED books SILENTLY (no welcome, no
 * partner notice). Those are the historical rows; a rental that is over
 * does not get welcomed. The rest of the BOOKED plan already takes care
 * of itself: scheduleCadenceForState refuses to schedule anything more
 * than an hour in the past, so no stale T-48 or pickup-morning mail can
 * come out of a catch-up.
 *
 * Every auto-book writes an AuditLog `order.auto_booked` naming the
 * trigger, so "who booked this?" is answerable — the answer is the
 * paperwork, and the row says which piece of it arrived last.
 */

import { prisma } from '@/lib/prisma'
import type { OrderStatus } from '@prisma/client'
import { bookOrder } from '@/lib/orders/bookOrder'
import { computeQuoteStatusSync } from '@/lib/orders/quoteStatus'
import { clientPaperworkIn } from '@/lib/orders/holdOnQuoteSend'
import { findPendingDayClaims } from '@/lib/orders/dayClaimGate'
import { partnerFloorGate } from '@/lib/sub-rentals/partnerMargins'
import { partnerPaperGate } from '@/lib/sub-rentals/partnerPaperGate'
import { isSignedAgreementStatus } from '@/lib/portal/agreementStatus'

/** Where an auto-book can start from. DRAFT is not on the list — see the header. */
export const AUTO_BOOKABLE_FROM: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'QUOTE_SENT',
  'APPROVED',
])

/** Already at or past the booking — nothing to do, and never a regression. */
export const AT_OR_PAST_BOOKED: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'BOOKED',
  'LOADED_READY',
  'ON_JOB',
  'RETURNED',
  'LD_CHECK',
  'INVOICED',
  'CLOSED',
])

export type AutoBookSkipReason =
  | 'order-not-found'
  | 'already-booked'
  | 'status-not-eligible'
  | 'coi-missing'
  | 'agreement-missing'
  | 'client-has-not-said-yes'
  | 'pending-day-claims'
  | 'partner-floor'
  | 'partner-unsigned'
  | 'book-failed'

export interface AutoBookResult {
  orderId: string
  orderNumber: string | null
  booked: boolean
  /** Present whenever `booked` is false. */
  reason?: AutoBookSkipReason
  /** Human-readable detail for the log / the script's report. */
  detail?: string
  /** What the client still owes, for the caller that wants to say so. */
  missing: string[]
  /** True when the book ran without the welcome email or partner notices. */
  silent: boolean
  /** Set on a dry run — what WOULD have happened. */
  dryRun?: boolean
}

/**
 * Has the client said yes to THIS order's money?
 *
 * APPROVED is a recorded yes (portal approval, or a rep's Mark Approved /
 * verbal attestation). A signature of the order's OWN is a yes too — the
 * client read this order's agreement and signed it.
 *
 * What fails the test: a QUOTE_SENT order whose only paper is a SIBLING
 * order's signature or the company's annual master. Those genuinely
 * paper the JOB — that is why they satisfy the agreement requirement —
 * but they are not an answer to a quote the client has not responded to.
 * Booking on them would snapshot a price nobody accepted and welcome the
 * client to a booking they were still thinking about.
 */
export function clientSaidYes(
  status: OrderStatus,
  rentalAgreements: { contractType: string; status: string }[],
): boolean {
  if (status === 'APPROVED') return true
  return rentalAgreements.some(
    (a) => a.contractType === 'RENTAL_AGREEMENT' && isSignedAgreementStatus(a.status),
  )
}

/** A pickup day already behind us — book it, but say nothing to anyone. */
export function isHistorical(startDate: Date | null, now: Date = new Date()): boolean {
  if (!startDate) return false
  return startDate.getTime() < now.getTime()
}

/**
 * Book `orderId` if — and only if — the paperwork says so.
 *
 * Safe to call from any event that could complete the set (a signature, a
 * COI decision, a quote approval) and from the nightly sweep. Idempotent:
 * an order already at or past BOOKED returns `already-booked` without
 * touching anything. Never throws — the triggering act must land whatever
 * happens here, so every caller can treat this as fire-and-forget.
 */
export async function maybeAutoBookOrder(
  orderId: string,
  opts: {
    /** What completed the set: 'agreement-signed' | 'coi-approved' | 'quote-approved' | 'sweep' | 'backfill'. */
    trigger: string
    userId?: string | null
    ipAddress?: string | null
    /** Evaluate and report, write nothing. */
    dryRun?: boolean
    /** Force the silent path (no welcome, no partner notices) regardless
     *  of dates — the backfill script's switch. */
    forceSilent?: boolean
    now?: Date
  },
): Promise<AutoBookResult> {
  const now = opts.now ?? new Date()
  const base = { orderId, orderNumber: null as string | null, booked: false, missing: [] as string[], silent: false }

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        startDate: true,
        sentAt: true,
        wonAt: true,
        lostAt: true,
        archivedAt: true,
        signedAgreements: { select: { contractType: true, status: true } },
      },
    })
    if (!order) return { ...base, reason: 'order-not-found' }

    const out = { ...base, orderNumber: order.orderNumber }
    if (AT_OR_PAST_BOOKED.has(order.status)) {
      return { ...out, reason: 'already-booked', detail: order.status }
    }
    if (!AUTO_BOOKABLE_FROM.has(order.status) || order.archivedAt) {
      return { ...out, reason: 'status-not-eligible', detail: order.archivedAt ? 'archived' : order.status }
    }

    const paperwork = await clientPaperworkIn(order.id)
    out.missing = paperwork.missing
    if (!paperwork.coiOk) return { ...out, reason: 'coi-missing' }
    if (!paperwork.signOk) return { ...out, reason: 'agreement-missing' }

    if (!clientSaidYes(order.status, order.signedAgreements)) {
      return {
        ...out,
        reason: 'client-has-not-said-yes',
        detail: 'papered by a sibling order or an annual master, but this quote is unanswered',
      }
    }

    // ── The same gates the manual button enforces ───────────────────
    const claims = await findPendingDayClaims(order.id)
    if (claims.length > 0) {
      return { ...out, reason: 'pending-day-claims', detail: `${claims.length} unresolved shoot-days claim(s)` }
    }
    const floor = await partnerFloorGate(order.id)
    if (!floor.ok) return { ...out, reason: 'partner-floor', detail: floor.message }
    const paper = await partnerPaperGate(order.id)
    if (!paper.ok) return { ...out, reason: 'partner-unsigned', detail: paper.message ?? undefined }

    const silent = opts.forceSilent === true || isHistorical(order.startDate, now)
    if (opts.dryRun) return { ...out, booked: true, silent, dryRun: true }

    // Reach APPROVED exactly the way the portal and mark-booked do, so
    // quoteStatus/wonAt carry the same stamps whichever path got here.
    if (order.status !== 'APPROVED') {
      const sync = computeQuoteStatusSync('APPROVED', {
        sentAt: order.sentAt,
        wonAt: order.wonAt,
        lostAt: order.lostAt,
      })
      await prisma.order.update({ where: { id: order.id }, data: { status: 'APPROVED', ...sync } })
    }

    const booked = await bookOrder({
      orderId: order.id,
      userId: opts.userId ?? null,
      ipAddress: opts.ipAddress ?? null,
      skipBookingWelcome: silent,
      skipPartnerNotices: silent,
    })
    if (!booked.ok) {
      return { ...out, reason: 'book-failed', detail: booked.error }
    }

    await prisma.auditLog
      .create({
        data: {
          action: 'order.auto_booked',
          entityType: 'Order',
          entityId: order.id,
          userId: opts.userId ?? null,
          ipAddress: opts.ipAddress ?? null,
          oldValues: { status: order.status } as never,
          newValues: {
            status: 'BOOKED',
            trigger: opts.trigger,
            rule: 'signed rental agreement + approved COI',
            silent,
            startDate: order.startDate?.toISOString() ?? null,
            cardOnFile: paperwork.cardOk,
          } as never,
        },
      })
      .catch(() => {
        /* audit is best-effort; the booking already committed */
      })

    return { ...out, booked: true, silent }
  } catch (err) {
    console.error('[autoBook] failed for', orderId, err)
    return { ...base, reason: 'book-failed', detail: err instanceof Error ? err.message : 'unknown' }
  }
}

/**
 * Every live order on a job. A COI is filed against the JOB, so one
 * decision can complete the set for several orders at once.
 */
export async function maybeAutoBookJob(
  jobId: string,
  opts: Parameters<typeof maybeAutoBookOrder>[1],
): Promise<AutoBookResult[]> {
  const orders = await prisma.order.findMany({
    where: { jobId, archivedAt: null, status: { in: [...AUTO_BOOKABLE_FROM] } },
    select: { id: true },
  })
  const out: AutoBookResult[] = []
  for (const o of orders) out.push(await maybeAutoBookOrder(o.id, opts))
  return out
}

/**
 * The nightly catch-all. Every path that can complete the paperwork set
 * calls maybeAutoBookOrder directly, but the inputs also move with no
 * event at all — an annual master starting its term, a company COI
 * carrying forward, a certificate someone filed straight onto the job.
 * Same reasoning as the hold-firmness sweep this runs beside.
 */
export async function sweepAutoBook(opts?: { dryRun?: boolean; now?: Date }): Promise<AutoBookResult[]> {
  const candidates = await prisma.order.findMany({
    where: { archivedAt: null, status: { in: [...AUTO_BOOKABLE_FROM] } },
    select: { id: true },
  })
  const out: AutoBookResult[] = []
  for (const c of candidates) {
    const r = await maybeAutoBookOrder(c.id, { trigger: 'sweep', dryRun: opts?.dryRun, now: opts?.now })
    if (r.booked || r.reason === 'book-failed') out.push(r)
  }
  return out
}
