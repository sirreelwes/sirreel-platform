/**
 * POST /api/orders/[id]/mark-booked
 *
 * "The client said yes" — recorded by a human, off the portal.
 *
 * Origin (Wes, 2026-09-09): "If they tell us this verbally or via email,
 * we should have a button to push that isn't 'on rental' because it may
 * not have started yet, but 'booked'." The pieces all existed — Mark
 * Approved on the order page (QUOTE_SENT → APPROVED), then Book it
 * (APPROVED → BOOKED) — but they were two clicks on a screen away from
 * where the work happens, and neither firmed the truck.
 *
 * One action, three effects:
 *   1. Stamps Order.verbalApproval* — the durable attestation. This is
 *      what survives the nightly hold-firmness cron; see the column
 *      comment in schema.prisma.
 *   2. Advances QUOTE_SENT/DRAFT → APPROVED (syncing quoteStatus to WON
 *      and stamping wonAt exactly as the portal approval does), then
 *      runs the real bookOrder() for BOOKED: booked-value snapshot,
 *      per-line lane routing, audit log, cadence projection.
 *   3. Firms the unit holds through reconcileHoldFirmness, which now
 *      honours the attestation — the reserved units read booked rather
 *      than staying rank-2 backups.
 *
 * WHAT IT SENDS — exactly what the existing "Book it" button sends, no
 * more, because it calls the same bookOrder():
 *   - sub-rental partner "it's a go" notices, for partners on this order;
 *   - a BOOKING_WELCOME email to the CLIENT — unless the order is booked
 *     straight from DRAFT (no quote sent; see BOOKABLE_FROM), in which
 *     case that one event is suppressed. bookOrder projects cadence to
 *     BOOKED, and scheduleCadenceForState queues BOOKING_WELCOME at
 *     offset 0 for the runner to send. Forward-only projection means an
 *     order whose cadence already reached BOOKED (portal sign path) does
 *     NOT get a second one.
 * Nothing NEW is composed here. The rental agreement is NOT released —
 * that stays the explicit "Send for signature" action — and the response's
 * `paperworkMissing` names it so the operator knows it is still outstanding.
 *
 * Idempotent: an order already at/after BOOKED returns ok with
 * alreadyBooked=true rather than re-stamping or re-notifying.
 *
 * Returns:
 *   200 { ok, orderId, orderNumber, status, alreadyBooked, quoteSkipped, holdsFirmed, paperworkMissing }
 *   401 { error: 'unauthorized' }
 *   404 { error: 'order not found' }
 *   409 { error, currentStatus }  — not a bookable source state
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { bookOrder } from '@/lib/orders/bookOrder'
import { computeQuoteStatusSync } from '@/lib/orders/quoteStatus'
import { reconcileHoldFirmness } from '@/lib/orders/holdOnQuoteSend'
import { findPendingDayClaims } from '@/lib/orders/dayClaimGate'

export const dynamic = 'force-dynamic'

/**
 * States a verbal yes can move FROM.
 *
 * DRAFT was excluded until 2026-09-10 on the grounds that a client cannot
 * have approved a quote that was never sent. Wes overruled it the same
 * day (God of Wrath & Ruin, S260829-005: a van nine days into its rental
 * on an order nobody ever quoted, and Jose could not invoice it): "allow
 * Jose to change to booked without having to resend quote." The draft's
 * live total is what gets snapshotted, so the agent owns the number.
 *
 * What still holds from the old objection: a client who never saw a
 * quote must not get a BOOKING_WELCOME quoting it. From DRAFT the book
 * runs with `skipBookingWelcome`; the pre-invoice round is the first
 * document they see. Past BOOKED the question is already settled.
 */
const BOOKABLE_FROM = new Set(['DRAFT', 'QUOTE_SENT', 'APPROVED'])
const ALREADY_BOOKED = new Set(['BOOKED', 'LOADED_READY', 'ON_JOB', 'RETURNED', 'LD_CHECK', 'INVOICED', 'CLOSED'])

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: { id: true, orderNumber: true, status: true, sentAt: true, wonAt: true, lostAt: true, verbalApprovalAt: true },
  })
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })

  if (ALREADY_BOOKED.has(order.status)) {
    return NextResponse.json({ ok: true, orderId: order.id, orderNumber: order.orderNumber, status: order.status, alreadyBooked: true, holdsFirmed: 0, paperworkMissing: [] })
  }
  if (!BOOKABLE_FROM.has(order.status)) {
    return NextResponse.json({ ok: false, error: `cannot mark booked from ${order.status}`, currentStatus: order.status }, { status: 409 })
  }

  // Same server-side gate the status PUT enforces (Wes ruling B): an
  // unresolved shoot-days claim on a gear/vehicle line blocks APPROVED
  // and beyond. Checked here too — this route reaches BOOKED without
  // passing through that handler.
  const pending = await findPendingDayClaims(order.id)
  if (pending.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: 'pending day claims',
        reason: `${pending.length} line${pending.length === 1 ? ' has' : 's have'} an unresolved shoot-days claim — resolve in the order's claims panel first.`,
        currentStatus: order.status,
      },
      { status: 409 },
    )
  }

  let userId: string | null = null
  try {
    const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
    userId = user?.id ?? null
  } catch {
    /* non-fatal — AuditLog.userId is nullable */
  }

  // 1. The attestation first, so a failure anywhere downstream still
  //    leaves the record of what the client said.
  await prisma.order.update({
    where: { id: order.id },
    data: {
      verbalApprovalAt: order.verbalApprovalAt ?? new Date(),
      verbalApprovalById: userId,
      verbalApprovalNote: note,
    },
  })

  // 2. Reach APPROVED the same way the portal does, then book for real.
  if (order.status !== 'APPROVED') {
    const sync = computeQuoteStatusSync('APPROVED', {
      sentAt: order.sentAt,
      wonAt: order.wonAt,
      lostAt: order.lostAt,
    })
    await prisma.order.update({ where: { id: order.id }, data: { status: 'APPROVED', ...sync } })
  }

  const ipAddress =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
  // Straight from DRAFT = no quote was ever sent. See BOOKABLE_FROM.
  const quoteSkipped = order.status === 'DRAFT'
  const booked = await bookOrder({ orderId: order.id, userId, ipAddress, skipBookingWelcome: quoteSkipped })
  if (!booked.ok) {
    return NextResponse.json({ ok: false, error: booked.error, currentStatus: booked.currentStatus }, { status: 409 })
  }

  await prisma.auditLog.create({
    data: {
      action: 'order.mark_booked_verbal',
      entityType: 'Order',
      entityId: order.id,
      userId,
      ipAddress,
      newValues: { from: order.status, to: 'BOOKED', note, quoteSkipped, bookingWelcomeSuppressed: quoteSkipped } as never,
    },
  }).catch(() => { /* audit is best-effort; the booking already committed */ })

  // 3. Firm the units. The attestation is now stamped, so this promotes
  //    even with paperwork outstanding — and reports what is outstanding.
  const holds = await reconcileHoldFirmness(order.id)

  return NextResponse.json({
    ok: true,
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: 'BOOKED',
    alreadyBooked: false,
    quoteSkipped,
    holdsFirmed: holds.promoted,
    holdsFirm: holds.firm,
    paperworkMissing: holds.missing,
  })
}
