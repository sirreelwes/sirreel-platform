import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { transitionCadenceState } from '@/lib/cadence/scheduler'
import type { LostReason } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Reasons a HUMAN may claim. NO_RESPONSE / ACKNOWLEDGED_NO_BOOK /
 * EXPLICIT_REJECTION are inferences the cadence runner and reply classifier
 * make from observed client behavior — a rep clicking a menu hasn't observed
 * anything, so they can't write those. MANUAL_CLOSE is excluded too: it
 * records HOW the order closed, not why, and "why" is the whole point of
 * asking.
 */
const HUMAN_REASONS = new Set<LostReason>([
  'LOST_TO_COMPETITOR',
  'BUDGET',
  'TIMING',
  'SCOPE_CHANGED',
  'OTHER',
])

/**
 * POST /api/orders/[id]/mark-lost        { reason: LostReason, note?: string }
 * POST /api/orders/[id]/mark-lost?undo=1 → reopen (clears the lost stamps)
 *
 * Sales classification, NOT a lifecycle transition. `status` is left exactly
 * where it is — a lost quote is still, factually, a quote that was sent. What
 * moves is `quoteStatus` → LOST plus the lost stamps, which is the same shape
 * the cadence runner writes when it declares an order lost on its own, so
 * both paths land in one state the pipeline reporting can count.
 *
 * `lostAt` is write-once by the same convention computeQuoteStatusSync uses.
 * `pickupDateAtLoss` snapshots how close to pickup we lost it (re-engagement
 * reporting reads it). Pending follow-up drafts are expired — nobody should
 * nudge a client we've written off.
 *
 * WON orders are refused rather than silently reclassified: an order that has
 * gear on it isn't a lost quote, and downgrading it would corrupt the booked
 * value snapshot the pipeline reports on. Cancel that one instead.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const undo = req.nextUrl.searchParams.get('undo') === '1'

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      quoteStatus: true,
      lostAt: true,
      startDate: true,
      cadenceState: true,
      notes: true,
    },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  if (undo) {
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id },
        data: {
          quoteStatus: order.status === 'DRAFT' ? 'DRAFT' : 'SENT',
          lostAt: null,
          lostReason: null,
          pickupDateAtLoss: null,
        },
      })
      // Un-expire the follow-up drafts, or "reopen" doesn't reopen. Marking
      // lost expires them; the follow-up cron can never replace them because
      // QuoteFollowUp is unique on (orderId, stage) — the expired row wins the
      // insert and the P2002 is swallowed as "another pass got there first".
      // So without this, a reopened quote silently has no follow-up ladder for
      // the rest of its life.
      //
      // Only rows nobody ACTED on come back: a sent or skipped follow-up is a
      // decision that already happened, and resurrecting it would re-queue an
      // email the rep already dealt with.
      await tx.quoteFollowUp.updateMany({
        where: { orderId: id, status: 'EXPIRED', sentAt: null, skippedAt: null },
        data: { status: 'PENDING' },
      })
    })
    // Put the cadence ladder back where the lifecycle says it belongs.
    try {
      await transitionCadenceState(id, order.status === 'DRAFT' ? 'QUOTE_DRAFT' : 'QUOTE_SENT')
    } catch (err) {
      console.error('[orders/mark-lost] undo cadence transition failed:', err)
    }
    return NextResponse.json({ ok: true, lostAt: null })
  }

  if (order.quoteStatus === 'WON') {
    return NextResponse.json(
      {
        error: 'order is already won',
        reason: 'This order was approved or booked — cancel it instead of marking it lost.',
      },
      { status: 409 },
    )
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const reason = body.reason as LostReason | undefined
  if (!reason || !HUMAN_REASONS.has(reason)) {
    return NextResponse.json(
      { error: 'reason must be one of: ' + Array.from(HUMAN_REASONS).join(', ') },
      { status: 400 },
    )
  }
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null

  const now = new Date()
  // APPEND to notes, never replace. Order.notes is a shared free-text field
  // the rep may already have working notes in; a lost-reason note is an
  // addition to the record, not a reason to erase what was there.
  const nextNotes = note
    ? [order.notes?.trim(), `Marked lost (${reason}): ${note}`].filter(Boolean).join('\n\n')
    : null

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id },
      data: {
        quoteStatus: 'LOST',
        lostReason: reason,
        lostAt: order.lostAt ?? now,
        pickupDateAtLoss: order.startDate,
        ...(nextNotes ? { notes: nextNotes } : {}),
      },
    })
    await tx.quoteFollowUp.updateMany({
      where: { orderId: id, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    })
  })

  // Outside the transaction — the scheduler opens its own, and a cadence
  // hiccup must not roll back the classification the rep just made.
  try {
    await transitionCadenceState(id, 'LOST')
  } catch (err) {
    console.error('[orders/mark-lost] cadence transition failed:', err)
  }

  return NextResponse.json({ ok: true, lostAt: order.lostAt ?? now, lostReason: reason })
}
