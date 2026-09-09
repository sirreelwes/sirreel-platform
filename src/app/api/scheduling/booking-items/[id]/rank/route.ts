/**
 * POST /api/scheduling/booking-items/[id]/rank — put this hold in the
 * queue, by hand.
 *
 * The two answers the reservation desk needs when a category is at
 * capacity and there is no replacement unit (Wes 2026-09-09):
 *
 *   { rank: 2 }                      → "2nd Hold". Queue behind whoever
 *                                      has it. Costs nobody anything;
 *                                      backups never consume capacity.
 *   { rank: 1, demoteOthers: true }  → "Make 1st Hold and demote other".
 *                                      This booking takes the front and
 *                                      the incumbent rank-1 holds on the
 *                                      same category+window drop to 2.
 *
 * Both LOCK the rank (`rankLockedAt`), and that is the whole point.
 * `reconcileHoldFirmness` otherwise re-ranks 1↔2 automatically off each
 * order's own paperwork — it would promote a deliberate 2nd Hold whose
 * paperwork is in, and it would undo a demotion the moment the demoted
 * order next reconciled (nightly cron + six other call sites). Wes's
 * ruling: queue position beats paperwork, so a human decision wins and
 * the sweep leaves it alone. Clearing the lock columns hands the hold
 * back to the automatic rule.
 *
 * Depth is capped at 3 (Wes): a 4-deep queue on one truck is a
 * sub-rental conversation, not a reservation.
 *
 * Demotion is audit-only — no email. Re-ranking is internal staff
 * business, and it follows the existing `booking_item.conflict_override`
 * precedent: stamp the note on the row AND emit an AuditLog so dispatch
 * sees it, not just the agent who did it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { can } from '@/lib/permissions'
import { MAX_HOLD_RANK, holdRankLabel } from '@/lib/scheduling/holdRanks'
import { getCategoryAvailability } from '@/lib/scheduling/availability'

export const dynamic = 'force-dynamic'

interface RankBody {
  rank?: number
  demoteOthers?: boolean
  reason?: string | null
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // Sales action, matching /promote: re-ranking the queue is a booking
  // decision, not an assignment.
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const actor = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true },
  })
  if (!actor || !can(actor.role, 'canCreateBooking')) {
    return NextResponse.json(
      { error: 'forbidden', reason: 'setting a hold rank is a sales action' },
      { status: 403 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as RankBody
  const rank = Number(body.rank)
  if (!Number.isInteger(rank) || rank < 1 || rank > MAX_HOLD_RANK) {
    return NextResponse.json(
      { error: 'invalid rank', reason: `Holds go 1st, 2nd, 3rd — rank must be 1..${MAX_HOLD_RANK}.` },
      { status: 400 },
    )
  }

  const item = await prisma.bookingItem.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      holdRank: true,
      status: true,
      categoryId: true,
      quantity: true,
      booking: { select: { id: true, bookingNumber: true, jobName: true, startDate: true, endDate: true } },
    },
  })
  if (!item) return NextResponse.json({ error: 'booking item not found' }, { status: 404 })
  if (!['REQUESTED', 'ASSIGNED'].includes(item.status)) {
    return NextResponse.json(
      { error: 'not rankable', reason: `A ${item.status} hold has left the queue.` },
      { status: 409 },
    )
  }

  // Everyone else in this category's window, so we can both enforce the
  // cap and know who we would be demoting.
  const others = await prisma.bookingItem.findMany({
    where: {
      categoryId: item.categoryId,
      id: { not: item.id },
      status: { in: ['REQUESTED', 'ASSIGNED'] },
      booking: {
        archivedAt: null,
        startDate: { lte: item.booking.endDate },
        endDate: { gte: item.booking.startDate },
      },
    },
    select: {
      id: true,
      holdRank: true,
      quantity: true,
      booking: { select: { bookingNumber: true, jobName: true } },
    },
    orderBy: { holdRank: 'asc' },
  })

  // A 1st Hold is NOT exclusive per category — a 4-van category can carry
  // four separate 1st Holds, one per van. Rank only becomes contended when
  // demand exceeds supply, so "is this slot taken?" is a CAPACITY question,
  // not "does any rank-1 exist?". The earlier version asked the latter and
  // would have refused the ordinary case of a second production booking a
  // different van on the same days.
  const availability = await getCategoryAvailability(
    item.categoryId,
    item.booking.startDate,
    item.booking.endDate,
    1,
    item.id, // exclude this hold's own demand — it is the one being placed
  )
  const roomAtFirst = availability.availableToHold >= item.quantity
  const incumbents = others.filter((o) => o.holdRank === 1)

  // Taking the front WITHOUT room, and without saying to demote anyone,
  // would silently put two 1st Holds on the same units — the exact
  // over-commit this endpoint exists to replace. With room, rank 1 is
  // simply granted.
  if (rank === 1 && !roomAtFirst && incumbents.length > 0 && !body.demoteOthers) {
    return NextResponse.json(
      {
        error: 'rank taken',
        reason: 'Another production already has the 1st Hold on these dates.',
        incumbents: incumbents.map((o) => ({
          bookingItemId: o.id,
          bookingNumber: o.booking.bookingNumber,
          jobName: o.booking.jobName,
          quantity: o.quantity,
        })),
      },
      { status: 409 },
    )
  }

  // Cap: demoting the incumbent pushes it to 2, so anything already at
  // MAX would be pushed off the end.
  if (rank === 1 && body.demoteOthers && !roomAtFirst) {
    const wouldOverflow = others.some((o) => o.holdRank >= MAX_HOLD_RANK)
    if (wouldOverflow) {
      return NextResponse.json(
        {
          error: 'stack full',
          reason: `Demoting would push a hold past ${MAX_HOLD_RANK}rd. Release one first, or sub-rent.`,
        },
        { status: 409 },
      )
    }
  }

  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null
  const now = new Date()

  const result = await prisma.$transaction(async (tx) => {
    const demoted: { id: string; from: number; to: number; bookingNumber: string }[] = []

    // Nobody is demoted when the category had room — the request simply
    // did not need anyone's slot, whatever the caller asked for.
    if (rank === 1 && body.demoteOthers && !roomAtFirst) {
      for (const inc of incumbents) {
        const to = inc.holdRank + 1
        await tx.bookingItem.update({
          where: { id: inc.id },
          data: {
            holdRank: to,
            // The demotion is a human decision too — lock it, or the
            // incumbent's own next reconcile promotes it straight back.
            rankLockedAt: now,
            rankLockedById: actor.id,
            rankLockedReason:
              `Demoted to ${holdRankLabel(to)} Hold for ${item.booking.bookingNumber}` +
              (reason ? ` — ${reason}` : ''),
          },
        })
        demoted.push({ id: inc.id, from: inc.holdRank, to, bookingNumber: inc.booking.bookingNumber })
      }
    }

    const updated = await tx.bookingItem.update({
      where: { id: item.id },
      data: {
        holdRank: rank,
        rankLockedAt: now,
        rankLockedById: actor.id,
        rankLockedReason: reason,
      },
      select: { id: true, holdRank: true },
    })

    return { updated, demoted }
  })

  // Audit — the demoted booking belongs to somebody else, so the trail
  // cannot live only with the agent who did it.
  try {
    await prisma.auditLog.create({
      data: {
        userId: actor.id,
        action: 'booking_item.rank_set',
        entityType: 'BookingItem',
        entityId: item.id,
        oldValues: { holdRank: item.holdRank },
        newValues: {
          holdRank: rank,
          rankLocked: true,
          reason,
          bookingNumber: item.booking.bookingNumber,
          jobName: item.booking.jobName,
          demoted: result.demoted,
        },
      },
    })
  } catch (err) {
    console.error('[rank] audit failed:', err instanceof Error ? err.message : err)
  }

  return NextResponse.json({
    ok: true,
    bookingItemId: result.updated.id,
    holdRank: result.updated.holdRank,
    rankLocked: true,
    demoted: result.demoted,
  })
}
