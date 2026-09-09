/**
 * Does this job put a SirReel VEHICLE in the client's hands?
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The COI review asks fifteen questions and two of them — Auto Liability and
 * Hired Auto Physical Damage — are about vehicles the client rents FROM US.
 * Nothing ever asked whether the job had one. On 2026-09-09 SR-JOB-0326 (MITU
 * NGL) rented a single Starlink Mini, and the desk emailed the client asking
 * their broker to add physical-damage coverage "on hired/rented autos — this
 * is what repairs or replaces the vehicle itself". The client wrote back:
 * "we are not renting any vehicles from Sir Reel. Please advise."
 *
 * They were right, and it is not a small thing to be wrong about: Hired Auto
 * Physical Damage is the line brokers push back on hardest, so we spent the
 * client's goodwill and their broker's time on coverage that protects a truck
 * nobody is renting.
 *
 * ── Computed, never stored ──────────────────────────────────────────────────
 * Same rule as src/lib/coi/insuredMatch.ts: the verdict is derived on READ
 * from what is on the job right now. Adding a truck to a gear-only job
 * re-imposes the auto requirements on the next read with nothing to re-run,
 * and taking one off clears them. That direction — the one where coverage
 * comes BACK — is the whole reason this is not a flag someone sets once.
 *
 * ── Unknown is not "no" ─────────────────────────────────────────────────────
 * Callers that cannot see the job (the /tools/coi-check scratchpad has no job
 * at all) pass nothing and get `null`, and every reader treats null as "assume
 * vehicles". Requiring coverage we did not need is an awkward email; skipping
 * coverage we did need is an uninsured truck.
 */

import type { LineItemDepartment } from '@prisma/client'

const VEHICLES: LineItemDepartment = 'VEHICLES'

/** Line types that put actual goods in a client's hands. A delivery FEE is
 *  billed under the vehicles department but is OUR driver in OUR truck — the
 *  client is not hiring the auto, so it must not drag in the auto checks. */
const GOODS_LINE_TYPES = new Set(['VEHICLE', 'EQUIPMENT', 'EXPENDABLE'])

/** A booking item in one of these is not going out on this job. */
const DEAD_ITEM_STATUSES = new Set(['SUBSTITUTED', 'UNFULFILLED'])
const DEAD_BOOKING_STATUSES = new Set(['CANCELLED', 'ARCHIVED'])
const DEAD_SUB_RENTAL_STATUSES = new Set(['CANCELLED'])

/** Structural, not Prisma types: four different queries feed this, each
 *  selecting the subset it already had a reason to load. */
export interface VehicleScopeInput {
  orders?: ReadonlyArray<{
    status?: string | null
    lineItems?: ReadonlyArray<{
      type?: string | null
      department?: string | null
      fulfillmentLane?: string | null
      assetCategory?: { department?: string | null } | null
      inventoryItem?: { department?: string | null } | null
    }> | null
  }> | null
  bookings?: ReadonlyArray<{
    status?: string | null
    items?: ReadonlyArray<{
      status?: string | null
      category?: { department?: string | null } | null
      catalogItem?: { department?: string | null } | null
    }> | null
  }> | null
  /** A partner truck is still a truck the client drives away. */
  subRentals?: ReadonlyArray<{
    status?: string | null
    subcontractedVehicleId?: string | null
  }> | null
}

export interface VehicleScope {
  /** null = the caller could not see the job. Treat as "assume vehicles". */
  hasVehicles: boolean | null
  /** What made it true — for the reviewer, so "we need auto coverage" can
   *  name the truck rather than asserting itself. */
  reasons: string[]
}

/** Did this caller supply anything to judge? An empty object is "unknown";
 *  a job with an empty order list is a real, answerable "no vehicles". */
function sawAnything(i: VehicleScopeInput): boolean {
  return !!i.orders || !!i.bookings || !!i.subRentals
}

export function deriveVehicleScope(input: VehicleScopeInput): VehicleScope {
  if (!sawAnything(input)) return { hasVehicles: null, reasons: [] }

  const reasons: string[] = []

  for (const order of input.orders ?? []) {
    if (order.status === 'CANCELLED') continue
    for (const li of order.lineItems ?? []) {
      if (li.type && !GOODS_LINE_TYPES.has(li.type)) continue
      const vehicle =
        li.type === 'VEHICLE' ||
        li.department === VEHICLES ||
        li.fulfillmentLane === 'FLEET' ||
        li.assetCategory?.department === VEHICLES ||
        li.inventoryItem?.department === VEHICLES
      if (vehicle) reasons.push('a vehicle line on an order')
    }
  }

  for (const booking of input.bookings ?? []) {
    if (booking.status && DEAD_BOOKING_STATUSES.has(booking.status)) continue
    for (const item of booking.items ?? []) {
      if (item.status && DEAD_ITEM_STATUSES.has(item.status)) continue
      if (item.category?.department === VEHICLES || item.catalogItem?.department === VEHICLES) {
        reasons.push('a vehicle held on a reservation')
      }
    }
  }

  for (const sub of input.subRentals ?? []) {
    if (sub.status && DEAD_SUB_RENTAL_STATUSES.has(sub.status)) continue
    if (sub.subcontractedVehicleId) reasons.push('a sub-rented partner vehicle')
  }

  return { hasVehicles: reasons.length > 0, reasons: Array.from(new Set(reasons)) }
}

/**
 * The Prisma select that answers the question, for routes assembling their
 * own job query. Kept here so a new caller cannot half-load it and get a
 * confident "no vehicles" out of a query that never looked at bookings.
 */
export const VEHICLE_SCOPE_SELECT = {
  orders: {
    select: {
      status: true,
      lineItems: {
        select: {
          type: true,
          department: true,
          fulfillmentLane: true,
          assetCategory: { select: { department: true } },
          inventoryItem: { select: { department: true } },
        },
      },
    },
  },
  bookings: {
    select: {
      status: true,
      items: {
        select: {
          status: true,
          category: { select: { department: true } },
          catalogItem: { select: { department: true } },
        },
      },
    },
  },
  subRentals: { select: { status: true, subcontractedVehicleId: true } },
} as const
