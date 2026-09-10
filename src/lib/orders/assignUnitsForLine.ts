/**
 * Put a truck on a vehicle line the moment the line is added.
 *
 * Wes 2026-09-10: "adding a vehicle to the order should trigger a hold
 * of that class of vehicle — assigning next available unit but agent
 * could reassign the vehicle later. If we could choose the unit too that
 * would be ideal."
 *
 * The HOLD half already existed (holdOnQuoteSend / syncHoldOnLineAdd —
 * a vehicle is held the moment it is quoted). What was missing is the
 * UNIT: a hold is a category line with a quantity and appears on no
 * unit row of the board, so every quoted vehicle turned into a
 * "needs-a-unit" follow-up. This runs right after the hold lands and
 * binds either the unit the rep named or the first free one.
 *
 * Rules, all inherited from the Make Reservation flow so the two paths
 * cannot disagree:
 *   · a hold BEHIND another production (rank > 1) gets no unit — the
 *     truck is somebody else's until they release it
 *   · "next available" takes the first FREE candidate in the server's
 *     nicest-tier-then-unit-number order; a buffer-state unit is never
 *     auto-picked (that needs a human override)
 *   · a NAMED unit is a deliberate choice and carries the buffer override
 *   · the assignment is stamped with the ORDER it was added on, which is
 *     the yard's "Order attached" indicator
 *
 * NON-FATAL by contract. The line is written and the class is held
 * whatever happens here; a unit that could not be bound is reported in
 * `note` and the hold shows in the needs-a-unit lane as before.
 *
 * Never on client paper: the unit lives on BookingAssignment, not on the
 * OrderLineItem, and the quote PDF reads lines only.
 */
import { prisma } from '@/lib/prisma'
import { getCategoryAvailability } from '@/lib/scheduling/availability'
import { assignUnitToBookingItem } from '@/lib/scheduling/assignUnit'

export type UnitAssignmentMode = 'next' | 'named' | 'none'

export interface UnitAssignmentRequest {
  /** Default 'next'. 'none' leaves the hold at category level (the Make
   *  Reservation modal ranks first and binds on its own). */
  mode?: UnitAssignmentMode
  /** For 'named': the units the rep picked, in order. Anything the names
   *  don't cover falls to next-available. */
  assetIds?: string[]
}

export interface UnitAssignmentOutcome {
  mode: UnitAssignmentMode
  bookingItemId: string | null
  assigned: { assetId: string; unitName: string; assignmentId: string }[]
  /** Something worth telling the rep — no free unit, a queued hold, a
   *  named unit that was refused. Null when everything landed. */
  note: string | null
}

export function parseUnitAssignment(raw: unknown): UnitAssignmentRequest {
  if (!raw || typeof raw !== 'object') return { mode: 'next' }
  const r = raw as { mode?: unknown; assetIds?: unknown }
  const mode: UnitAssignmentMode = r.mode === 'named' || r.mode === 'none' ? r.mode : 'next'
  const assetIds = Array.isArray(r.assetIds) ? r.assetIds.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
  return { mode: mode === 'named' && assetIds.length === 0 ? 'next' : mode, assetIds }
}

export async function assignUnitsForLine(args: {
  orderId: string
  categoryId: string
  /** How many units THIS line asked for. */
  quantity: number
  request: UnitAssignmentRequest
  categoryLabel?: string | null
}): Promise<UnitAssignmentOutcome> {
  const mode = args.request.mode ?? 'next'
  const out: UnitAssignmentOutcome = { mode, bookingItemId: null, assigned: [], note: null }
  if (mode === 'none') return out

  try {
    const order = await prisma.order.findUnique({
      where: { id: args.orderId },
      select: { id: true, bookingId: true },
    })
    if (!order?.bookingId) {
      out.note = 'No hold was minted for this line, so there is nothing to put a unit on.'
      return out
    }
    // Lowest rank wins — the same read as /api/scheduling/order-hold.
    const item = await prisma.bookingItem.findFirst({
      where: { bookingId: order.bookingId, categoryId: args.categoryId },
      orderBy: { holdRank: 'asc' },
      select: {
        id: true,
        quantity: true,
        holdRank: true,
        booking: { select: { startDate: true, endDate: true } },
        assignments: { where: { status: { in: ['ASSIGNED', 'CHECKED_OUT'] } }, select: { assetId: true } },
        category: { select: { name: true } },
      },
    })
    if (!item) {
      out.note = 'The hold for this line could not be read back — check the reservation on the job.'
      return out
    }
    out.bookingItemId = item.id
    const label = args.categoryLabel ?? item.category.name

    if (item.holdRank > 1) {
      out.note = `${label}: this job is queued behind another production for the class — no unit until the hold ahead releases.`
      return out
    }

    const remaining = Math.max(0, item.quantity - item.assignments.length)
    const want = Math.min(Math.max(1, Math.floor(args.quantity)), remaining)
    if (want === 0) return out

    const taken = new Set(item.assignments.map((a) => a.assetId))

    // Named units first, in the order picked. A deliberate human choice
    // carries the buffer override the next-available pass withholds.
    if (mode === 'named') {
      for (const assetId of (args.request.assetIds ?? []).slice(0, want)) {
        if (taken.has(assetId)) continue
        const res = await assignUnitToBookingItem({
          bookingItemId: item.id,
          assetId,
          bufferOverride: true,
          orderId: order.id,
        })
        if (!res.ok) {
          const reason = (res.body.reason as string | undefined) || (res.body.error as string | undefined) || `HTTP ${res.status}`
          const name = await unitName(assetId)
          out.note = `${name} could not be assigned (${reason}). The class is still held.`
          return out
        }
        taken.add(assetId)
        out.assigned.push({ assetId, unitName: res.assignment.asset.unitName, assignmentId: res.assignment.id })
      }
    }

    // Whatever the names did not cover falls to next-available.
    while (out.assigned.length < want) {
      const availability = await getCategoryAvailability(
        args.categoryId,
        item.booking.startDate,
        item.booking.endDate,
        1,
        item.id,
      )
      const candidates = availability.units
        .filter((u) => !taken.has(u.assetId))
        .sort((a, b) => {
          const tier = { PREMIUM: 0, STANDARD: 1, ECONOMY: 2 } as Record<string, number>
          const t = (tier[a.tier] ?? 9) - (tier[b.tier] ?? 9)
          if (t !== 0) return t
          return a.unitName.localeCompare(b.unitName, undefined, { numeric: true })
        })
      const next = candidates.find((u) => u.state === 'free')
      if (!next) {
        out.note =
          out.assigned.length === 0
            ? `${label}: no unit is free for those dates — the class is held and the line shows in the needs-a-unit lane.`
            : `${label}: only ${out.assigned.length} of ${want} could be assigned — no other unit is free.`
        return out
      }
      const res = await assignUnitToBookingItem({ bookingItemId: item.id, assetId: next.assetId, orderId: order.id })
      if (!res.ok) {
        // Somebody grabbed it between the read and the write. Skip it and
        // try the next one rather than giving up on the whole line.
        taken.add(next.assetId)
        continue
      }
      taken.add(next.assetId)
      out.assigned.push({ assetId: next.assetId, unitName: res.assignment.asset.unitName, assignmentId: res.assignment.id })
    }
    return out
  } catch (err) {
    console.error('[assignUnitsForLine] failed:', err instanceof Error ? err.message : err)
    out.note = 'The unit could not be assigned automatically — pick one from the job page.'
    return out
  }
}

async function unitName(assetId: string): Promise<string> {
  const a = await prisma.asset.findUnique({ where: { id: assetId }, select: { unitName: true } })
  return a?.unitName ?? 'That unit'
}

/**
 * After an AI-parsed order is created (from-parse) the holds are raised
 * for the whole order at once; this walks every vehicle line that
 * resolves to a category and binds next-available for each class.
 * Quantity per class is the peak the hold was sized to, so the loop
 * asks for the whole hold and stops when it is covered.
 */
export async function assignNextAvailableForOrder(orderId: string): Promise<UnitAssignmentOutcome[]> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      bookingId: true,
      lineItems: {
        select: {
          type: true,
          department: true,
          quantity: true,
          assetCategoryId: true,
          inventoryItem: { select: { legacyAssetCategoryId: true, department: true } },
        },
      },
    },
  })
  if (!order?.bookingId) return []
  const byCategory = new Map<string, number>()
  for (const li of order.lineItems) {
    if (li.type === 'FEE' || li.type === 'DISCOUNT' || li.type === 'LABOR' || li.type === 'EXPENDABLE') continue
    const dept = li.inventoryItem?.department ?? li.department
    if (dept !== 'VEHICLES') continue
    const categoryId = li.assetCategoryId ?? li.inventoryItem?.legacyAssetCategoryId ?? null
    if (!categoryId) continue
    byCategory.set(categoryId, (byCategory.get(categoryId) ?? 0) + Math.max(1, li.quantity))
  }
  const outcomes: UnitAssignmentOutcome[] = []
  for (const [categoryId, quantity] of byCategory) {
    outcomes.push(await assignUnitsForLine({ orderId, categoryId, quantity, request: { mode: 'next' } }))
  }
  return outcomes
}
