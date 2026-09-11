/**
 * PARTNER LINES stay off the pick list.
 *
 * Wes 2026-09-11: "keep partner lines off the pick list." A partner's unit —
 * VSM Planet's strobes, PowerTrip's generator, King Kong's coach — is
 * delivered by the partner or collected from them. It never passes through
 * SirReel's warehouse, so a pick task for it is a task nobody can do, and an
 * order waiting for it to be "loaded" never reads ready.
 *
 * A partner line is one a partner's ROSTER unit fulfils (a SubRental with
 * subcontractedVehicleId, not cancelled), or one riding under such a line.
 * An ad-hoc gear sub-rental from another rental house ("Sub-rent…" on a line,
 * POST /api/sub-rentals) has no roster unit — our crew usually collects that
 * gear and pulls it with the order — so it stays on the list.
 *
 * A would-be WAREHOUSE line that is a partner line gets NO lane and NO pick
 * status (every warehouse reader keys on fulfillmentLane === 'WAREHOUSE').
 * FLEET and STAGE routings are left alone — that is not the pick list.
 *
 * Pure bits and a Prisma where only; the pick-list writes live in
 * pickListSync.ts (a runtime import from there would be a cycle).
 */
import type { FulfillmentLane, LineItemPickStatus, Prisma, PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

/** A partner's roster unit booked on the line, and still live. */
export const PARTNER_SUB_RENTAL_WHERE: Prisma.SubRentalWhereInput = {
  subcontractedVehicleId: { not: null },
  status: { not: 'CANCELLED' },
}

/** The line, or the line it rides under, is fulfilled by a partner's unit. */
export const PARTNER_LINE_WHERE: Prisma.OrderLineItemWhereInput = {
  OR: [
    { subRentals: { some: PARTNER_SUB_RENTAL_WHERE } },
    { parentLineItem: { is: { subRentals: { some: PARTNER_SUB_RENTAL_WHERE } } } },
  ],
}

export async function isPartnerLine(db: Db, orderLineItemId: string): Promise<boolean> {
  return (await db.orderLineItem.count({ where: { AND: [{ id: orderLineItemId }, PARTNER_LINE_WHERE] } })) > 0
}

/** For callers that already hold the order's lines, each loaded with
 *  `subRentals: { where: PARTNER_SUB_RENTAL_WHERE }`: the line, or the line
 *  it rides under, is a partner line. */
export function isPartnerLineIn(
  line: { parentLineItemId?: string | null; subRentals?: unknown[] | null },
  lines: { id: string; subRentals?: unknown[] | null }[],
): boolean {
  if ((line.subRentals?.length ?? 0) > 0) return true
  if (!line.parentLineItemId) return false
  const parent = lines.find((l) => l.id === line.parentLineItemId)
  return (parent?.subRentals?.length ?? 0) > 0
}

export interface LineRouting {
  lane: FulfillmentLane | null
  pickStatus: LineItemPickStatus | null
}

/** The department's routing, less the warehouse for a partner line. */
export function partnerRouting(
  routing: { lane: FulfillmentLane; pickStatus: LineItemPickStatus | null },
  partner: boolean,
): LineRouting {
  if (partner && routing.lane === 'WAREHOUSE') return { lane: null, pickStatus: null }
  return routing
}
