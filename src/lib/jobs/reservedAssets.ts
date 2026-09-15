/**
 * The rows behind the job page's "Reserved assets" tile — one per RESERVATION,
 * not one per unit.
 *
 * The distinction is the whole point. A production routinely takes the same
 * van more than once on one job, and the tile used to key its map on
 * `asset.id` with first-wins, so the second trip silently disappeared behind
 * the first. Wrong Number (SR-JOB-0273) on 2026-09-15: Pass 10 went out Sep 3
 * on one Planyo cart and again on Sep 16 with Pass 8 and Pass 9. The gantt
 * drew three bars on the 16th; the job tile showed two of them and a third
 * van dated twelve days earlier with no order chip. Wes: "they need to stay
 * consistent between the job, the orders, and the reservations page."
 *
 * The collapse also cost the hidden trip its Drivers row — that card keys on
 * `bookingAssignmentId`, so a reservation missing here has nowhere to name a
 * driver.
 *
 * SWAPPED is still skipped: a unit taken off the job is history, kept so the
 * record reads back, not a reserved asset.
 */

export interface ReservedAssetSourceAssignment {
  id: string
  startDate: string
  endDate: string
  status: string
  asset: { id: string; unitName: string }
  order?: { id: string; orderNumber: string; status: string; warehouseOrderExpected?: boolean } | null
  driverAssignments?: unknown[]
  checkoutRecords?: {
    driverId?: string | null
    returnTime?: string | null
    driverReturnedAt?: string | null
    mileageIn?: number | null
  }[]
}

export interface ReservedAssetSourceBooking {
  id: string
  status: string
  items: { category: { name: string }; assignments: ReservedAssetSourceAssignment[] }[]
}

export interface ReservedAssetRow {
  assetId: string
  unitName: string
  category: string
  startDate: string
  endDate: string
  status: string
  bookingId: string
  bookingAssignmentId: string
  attachedOrder: { id: string; orderNumber: string; status: string; warehouseOrderExpected: boolean } | null
  drivers: any[]
  currentDriverId: string | null
  unitReturned: boolean
  driverReturnedAt: string | null
  driverReturnMileage: number | null
}

/**
 * Orders that are over. A unit still stamped to one is drift, not a plan.
 *
 * CANCELLED is the only such value on `OrderStatus` — LOST belongs to
 * `OrderQuoteStatus` and VOID to invoices, so neither can appear here. CLOSED
 * is deliberately absent: a closed order really did take those units out.
 */
export const DEAD_ORDER_STATUSES = new Set(['CANCELLED'])

export function buildReservedAssets(
  bookings: ReservedAssetSourceBooking[] | null | undefined,
): ReservedAssetRow[] {
  const rows: ReservedAssetRow[] = []
  for (const b of bookings ?? []) {
    if (b.status === 'CANCELLED' || b.status === 'ARCHIVED') continue
    for (const it of b.items) {
      for (const a of it.assignments) {
        // SWAPPED is a unit that was taken OFF this job — released, or
        // replaced by another truck. Terminal-but-auditable: kept so history
        // reads back, never a reserved asset. Rendering it here put a
        // released Cube 5 in E.L.F. Project Sooth's "1 unit" count with
        // nothing to do about it (Wes 2026-09-10).
        if (a.status === 'SWAPPED') continue
        const checkout = a.checkoutRecords?.[0]
        rows.push({
          assetId: a.asset.id,
          unitName: a.asset.unitName,
          category: it.category.name,
          startDate: a.startDate,
          endDate: a.endDate,
          status: a.status,
          bookingId: b.id,
          bookingAssignmentId: a.id,
          // The order this unit goes out ON (BookingAssignment.orderId).
          attachedOrder: a.order
            ? {
                id: a.order.id,
                orderNumber: a.order.orderNumber,
                status: a.order.status,
                // "A warehouse order is coming on this reservation"
                // (Wes 2026-09-14) — the tile is where it gets acted on,
                // because "+ Warehouse order" is right there.
                warehouseOrderExpected: !!a.order.warehouseOrderExpected,
              }
            : null,
          drivers: (a.driverAssignments as any[]) ?? [],
          currentDriverId: checkout?.driverId ?? null,
          unitReturned: !!checkout?.returnTime,
          // A driver self return on a blind drop (selfReturn.ts): filed, not
          // yet received.
          driverReturnedAt: checkout?.driverReturnedAt ?? null,
          driverReturnMileage: checkout?.mileageIn ?? null,
        })
      }
    }
  }
  // Unit name, then window — so a van taken twice reads in the order it goes
  // out, rather than in whatever order the bookings happened to load.
  return rows.sort(
    (x, y) =>
      x.unitName.localeCompare(y.unitName, undefined, { numeric: true })
      || x.startDate.localeCompare(y.startDate),
  )
}
