import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { reconcileHoldFirmness } from '@/lib/orders/holdOnQuoteSend'
import { sweepAutoBook } from '@/lib/orders/autoBook'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/hold-firmness — nightly reconcile of every live order's
 * hold rank against the rule in reconcileHoldFirmness: firm (rank 1)
 * only when the client has approved AND their paperwork is in.
 *
 * WHY A SWEEP AT ALL (Wes 2026-09-01: "add a nightly sweep to catch the
 * card case"). Reconcile is called from each event that can move its
 * inputs — quote approval, COI decision, agreement signature — but
 * CARD CAPTURE has no hook: nothing in this repo writes
 * ccCardNumberEncrypted, so a hold whose last missing piece is the card
 * would never promote. It also covers the inputs that change with no
 * event at all: a COI that simply reaches its expiry date should drop a
 * firm hold back to a backup, and no user action marks that moment.
 *
 * Idempotent by construction — a settled book changes nothing, which is
 * the normal result. Scoped to orders that actually own holds so the
 * run stays small.
 *
 * SINCE 2026-09-19 it also runs the AUTO-BOOK sweep (lib/orders/autoBook.ts)
 * — same reasoning, one rung up. Every path that completes the client's
 * paperwork books the order on the spot, but the inputs move with no event
 * at all too: an annual master reaching its effective date, a company
 * certificate carrying forward onto a new job. The sweep is the catch-all,
 * and like the reconcile above it changes nothing on a normal night.
 *
 * Trigger manually with:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://hq.sirreel.com/api/cron/hold-firmness
 */

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return (req.headers.get('authorization') || '') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Only orders that own a live hold can change rank — everything else
  // is a wasted round trip.
  const orders = await prisma.order.findMany({
    where: {
      archivedAt: null,
      status: { notIn: ['CANCELLED'] },
      OR: [
        { booking: { items: { some: { status: 'REQUESTED' } } } },
        { job: { bookings: { some: { source: 'AGENT_DIRECT', items: { some: { status: 'REQUESTED' } } } } } },
      ],
    },
    select: { id: true, orderNumber: true },
  })

  const changes: {
    orderNumber: string
    promoted: number
    demoted: number
    firm: boolean
    missing: string[]
  }[] = []
  const errors: { orderNumber: string; error: string }[] = []

  for (const o of orders) {
    const r = await reconcileHoldFirmness(o.id)
    if (r.error) {
      // Logged, not thrown: one bad order must not stop the sweep.
      console.error('[cron/hold-firmness]', o.orderNumber, r.error)
      errors.push({ orderNumber: o.orderNumber, error: r.error })
      continue
    }
    if (r.promoted > 0 || r.demoted > 0) {
      changes.push({
        orderNumber: o.orderNumber,
        promoted: r.promoted,
        demoted: r.demoted,
        firm: r.firm,
        missing: r.missing,
      })
    }
  }

  if (changes.length > 0) {
    // Visible in the Vercel log without needing an email for what is
    // usually a no-op night.
    console.log('[cron/hold-firmness] rank changes:', JSON.stringify(changes))
  }

  // Auto-book last: a hold that just firmed is the same paperwork the
  // book rule reads, and this way one run settles both. Scoped on its own
  // (every QUOTE_SENT/APPROVED order, holds or not) because an order with
  // no reservation still has a status that should say BOOKED.
  let autoBooked: { orderNumber: string | null; silent: boolean; reason?: string }[] = []
  try {
    autoBooked = (await sweepAutoBook()).map((r) => ({
      orderNumber: r.orderNumber,
      silent: r.silent,
      ...(r.booked ? {} : { reason: `${r.reason}: ${r.detail ?? ''}`.trim() }),
    }))
    if (autoBooked.length > 0) {
      console.log('[cron/hold-firmness] auto-booked:', JSON.stringify(autoBooked))
    }
  } catch (err) {
    console.error('[cron/hold-firmness] auto-book sweep failed:', err)
  }

  return NextResponse.json({
    ok: errors.length === 0,
    checked: orders.length,
    changed: changes.length,
    changes,
    autoBooked,
    errors,
  })
}
