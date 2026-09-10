/**
 * POST /api/scheduling/booking-items/[id]/release
 *   body (all optional): { assetId?: string, assetIds?: string[],
 *                          pooledSlots?: number, planyoReservationId?: string }
 *
 * Release a hold at any active state.
 *
 * NO BODY — the whole category line comes down:
 *   · REQUESTED/ASSIGNED → UNFULFILLED, and every active
 *                  BookingAssignment on it flips to SWAPPED in the same
 *                  transaction. SWAPPED is terminal-but-auditable; the
 *                  rows stay so we can read history later. Backups
 *                  (rank ≥ 2) on the same window are NOT touched —
 *                  releasing a primary leaves the queue intact;
 *                  promotion is always manual.
 *   · UNFULFILLED → idempotent ok, alreadyReleased=true (still sweeps
 *                  stranded assignments — see the lib).
 *   · SUBSTITUTED → 409 (an already-terminal state we don't manage
 *                  through this route).
 *
 * WITH assetId/assetIds — only those units are handed back (Wes
 * 2026-09-10). A BookingItem is a category line with a quantity, so one
 * row can hold two motorhomes; the Gantt bar a rep clicks is ONE of
 * them. Releasing off a bar used to take the sibling truck down with it.
 * The named form swaps only the named assignments and drops the line's
 * quantity to match; when nothing would be left it degrades to the
 * whole-line release above. See src/lib/scheduling/releaseBookingItem.ts
 * for the full contract — this route is a thin authenticated wrapper so
 * the endpoint, the job's Release-holds list and the Planyo auto-release
 * cron cannot drift apart.
 *
 * Does NOT cascade to the parent Booking. A Booking can hold a
 * mix of UNFULFILLED + ASSIGNED items; archiving the parent is a
 * separate deliberate action.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { can } from '@/lib/permissions'
import { releaseBookingItem } from '@/lib/scheduling/releaseBookingItem'
import { settlePlanyoCancellation } from '@/lib/sync/planyo/settleCancellation'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  // SALES action (per Wes): releasing a hold (primary bar or backup)
  // terminates the reservation item — a booking decision, not an assignment.
  // Was canAssignAssets (requireDispatchAccess); fleet/warehouse no longer pass.
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const actor = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { role: true },
  })
  if (!actor || !can(actor.role, 'canCreateBooking')) {
    return NextResponse.json(
      { error: 'forbidden', reason: 'releasing a hold is a sales action' },
      { status: 403 },
    )
  }

  // A body is optional — the old callers (stale-holds sweep, Planyo
  // cancellations) POST with none at all, and must keep meaning "the
  // whole line".
  const body = (await req.json().catch(() => null)) as
    | {
        assetId?: unknown
        assetIds?: unknown
        pooledSlots?: unknown
        planyoReservationId?: unknown
      }
    | null
  const namedAssets = [
    ...(typeof body?.assetId === 'string' ? [body.assetId] : []),
    ...(Array.isArray(body?.assetIds) ? body!.assetIds.filter((x): x is string => typeof x === 'string') : []),
  ]
  const pooledSlots =
    typeof body?.pooledSlots === 'number' && Number.isFinite(body.pooledSlots)
      ? Math.max(0, Math.trunc(body.pooledSlots))
      : 0
  // /planyo-cancellations passes the reservation it is clearing, so the
  // release can also RECORD that Planyo's cancellation has been actioned.
  // Without it the Reservation stayed at HOLD, the daily sync re-probed
  // it, Planyo still said cancelled, and the row came back as a
  // RELEASE_CANDIDATE the next morning — every morning. That backlog is
  // what kept the auto-release circuit breaker tripped (see
  // src/lib/sync/planyo/settleCancellation.ts). Optional, so every other
  // caller of this one release path is unchanged.
  const planyoReservationId =
    typeof body?.planyoReservationId === 'string' && body.planyoReservationId
      ? body.planyoReservationId
      : null

  const item = await prisma.bookingItem.findUnique({
    where: { id: params.id },
    select: { id: true, booking: { select: { id: true, bookingNumber: true } }, holdRank: true },
  })
  if (!item) return NextResponse.json({ error: 'booking item not found' }, { status: 404 })

  const outcome = await releaseBookingItem(
    params.id,
    namedAssets.length || pooledSlots ? { assetIds: namedAssets, pooledSlots } : {},
  )
  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.code === 'NOT_FOUND' ? 'booking item not found' : 'cannot release', reason: outcome.reason, bookingItemId: params.id },
      { status: outcome.code === 'NOT_FOUND' ? 404 : 409 },
    )
  }

  // Only meaningful when the WHOLE line came down. A per-unit release
  // off a multi-truck line leaves the category line still holding, so
  // the Planyo row is not settled yet.
  let planyoSettled = false
  if (planyoReservationId && outcome.status === 'UNFULFILLED') {
    const settled = await settlePlanyoCancellation(planyoReservationId)
    planyoSettled = settled.settled || settled.alreadySettled
  }

  return NextResponse.json({
    ok: true,
    alreadyReleased: outcome.alreadyReleased,
    planyoSettled,
    bookingItemId: outcome.bookingItemId,
    bookingItem: { id: outcome.bookingItemId, status: outcome.status, quantity: outcome.quantity, holdRank: item.holdRank },
    booking: item.booking,
    swappedAssignmentCount: outcome.swappedAssignmentCount,
    mode: outcome.mode,
    unmatchedAssetIds: outcome.unmatchedAssetIds,
    holdRank: item.holdRank,
  })
}
