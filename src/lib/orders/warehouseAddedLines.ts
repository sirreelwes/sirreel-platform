/**
 * Gear the WAREHOUSE put on the order, at check-out.
 *
 * Oliver, 2026-09-13: "On RW they had the ability to actually make the
 * swap and/or add a line item. This is crucial, because the driver needs
 * a copy of the exact order they're picking up."
 *
 * ── What this reverses, and what it keeps ─────────────────────────
 *
 * Until now an ADDED row on a check-out sheet was recorded and flagged
 * and NEVER written onto the order (see lib/orders/checkReports.ts).
 * The reasoning, from Hugo's meeting on 2026-09-03, was about money: the
 * yard cannot see rates ([[project-yard-single-view]]), so a line the
 * floor adds would land at $0 and under-bill the job without anyone
 * noticing.
 *
 * That reasoning is sound and this module does not throw it away — it
 * separates the two halves that were stuck together. "The line exists on
 * the order" and "the line is billed at zero" are different facts. So:
 *
 *   · the line lands on the order, which is what makes the order, the
 *     invoice and the driver's receipt describe the same truck;
 *   · it is priced from the CLIENT'S RATE CARD when the floor named the
 *     item off the catalog — the ordinary case, and the correct price,
 *     not a guess;
 *   · when they could not name it, the line lands UNPRICED
 *     (`pricingPendingAt`), which BLOCKS the invoice and the corrected
 *     quote until an agent prices it. Loud and stuck, rather than quiet
 *     and free. See lib/orders/unpricedLines.ts.
 *
 * ── What it deliberately does NOT do ──────────────────────────────
 *
 * This is not the rep's POST /api/orders/[id]/line-items and must not
 * grow into it. That route runs kit sync, capacity 409s, hold sync,
 * package math and day claims, all of which are wrong here:
 *
 *   · no kit sync — the floor writing "battery" on a sheet must not
 *     auto-append a charging bank to the client's bill;
 *   · no capacity check — the gear is physically on a truck already, and
 *     a 409 for something that has left the building is nonsense;
 *   · no hold sync — same reason, plus VEHICLES adds from a count sheet
 *     are not a thing the floor does;
 *   · no rate override audit — nobody typed a rate, so there is no
 *     override to attribute to anyone.
 *
 * It DOES take the things that keep the rest of HQ honest: server-side
 * pricing, the order's own window, the pick-list lane sync, an audit row,
 * and totals.
 */

import { Prisma, type LineItemDepartment, type LineItemType } from '@prisma/client'
import { computeLineTotal, computeBillableDays, weeklyRateApplies, weeklyRateCap } from '@/lib/orders/billing'
import { computeDays } from '@/lib/orders/days'
import { resolveLineRate } from '@/lib/pricing/resolveRate'

type Tx = Prisma.TransactionClient

/** One written-in row, as the sheet recorded it. */
export interface WarehouseAddedInput {
  description: string
  quantity: number
  note: string | null
  /**
   * The catalog item the supervisor picked on the check-out screen, when
   * they could. This is the ONLY thing that prices the line, and it is a
   * deliberate choice not to guess: matching "cp battery" against the
   * catalog by text would sooner or later put the wrong rate on a client's
   * invoice, and an unpriced line that stops the invoice is a far cheaper
   * mistake than a confidently wrong one.
   */
  inventoryItemId: string | null
}

export interface WarehouseAddedResult {
  orderLineItemId: string
  description: string
  quantity: number
  /** Null when it went on unpriced. */
  rate: number | null
  department: LineItemDepartment
  unpriced: boolean
}

/** The order facts this needs. Dates are the order's maintained mirror
 *  (syncOrderWindow) — never typed by a person, which is what makes them
 *  safe to anchor a line to. */
export interface WarehouseAddedOrder {
  id: string
  companyId: string
  startDate: Date | null
  endDate: Date | null
}

/**
 * Creates one order line per written-in row, inside the check report's
 * own transaction so the sheet and the lines land together or not at all.
 *
 * Returns what it made, in input order, for the audit row and the
 * supervisor's read-back.
 */
export async function createWarehouseAddedLines(
  tx: Tx,
  args: {
    order: WarehouseAddedOrder
    rows: WarehouseAddedInput[]
    /** The associate named on the sheet. */
    preppedBy: string | null
    /** One stamp for the whole filing, so the lines sort together. */
    at: Date
  },
): Promise<WarehouseAddedResult[]> {
  const { order, rows, preppedBy, at } = args
  if (rows.length === 0) return []

  // The window the gear actually went out on. Order.startDate/endDate is
  // the maintained mirror of the line dates; a line added from a count
  // sheet must inherit it rather than invent one, the same rule the
  // paste-a-list parser follows. Falling back to the filing day keeps a
  // dateless DRAFT from producing a null-date line the biller cannot
  // compute.
  const pickup = order.startDate ?? at
  const ret = order.endDate ?? order.startDate ?? at

  const last = await tx.orderLineItem.findFirst({
    where: { orderId: order.id },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  })
  let sortOrder = (last?.sortOrder ?? 0) + 1

  const calDays = Math.max(
    1,
    Math.round((ret.getTime() - pickup.getTime()) / 86_400_000) + 1,
  )

  const made: WarehouseAddedResult[] = []
  for (const row of rows) {
    const quantity = Math.max(1, Math.floor(row.quantity || 1))

    // Department and type come off the catalog row when there is one —
    // the same lookup the rep's POST does — and default to Pro Supplies
    // otherwise, which is also that route's default.
    let department: LineItemDepartment = 'PRO_SUPPLIES'
    let clientNote: string | null = null
    // Free by CATALOG POLICY — an accessory that rides along with
    // something else. Read here because it is the difference between a
    // line that is correctly $0 and a line nobody has priced, and those
    // must not look alike: one bills fine, the other stops the invoice.
    let includedFree = false
    if (row.inventoryItemId) {
      const inv = await tx.inventoryItem.findUnique({
        where: { id: row.inventoryItemId },
        select: { department: true, clientNote: true, includedFree: true },
      })
      if (inv) {
        department = inv.department
        clientNote = inv.clientNote?.trim() || null
        includedFree = inv.includedFree
      }
    }
    // The catalog carries no rental/sale flag — the DEPARTMENT is the
    // signal, the same read the pull sheet makes when it prints RENT vs
    // SALE. A consumable written in by the floor must not bill as a
    // rental for the day count.
    const type: LineItemType = department === 'EXPENDABLES' ? 'EXPENDABLE' : 'EQUIPMENT'

    // Price it the way every other line is priced: the client's
    // negotiated rate when they have one, else catalog. `clientRate: 0`
    // is not an override request here — there is no rep and no typed
    // number, so resolveLineRate's catalog branch simply wins whenever
    // the catalog can price it.
    let rate = new Prisma.Decimal(0)
    let resolvedRate: Prisma.Decimal | null = null
    const rateType: 'DAILY' | 'WEEKLY' = 'DAILY'
    let billableDays = calDays
    /** Nobody has put a price on this. Distinct from a line that is $0
     *  on purpose — see includedFree above. */
    let unpriced = !row.inventoryItemId
    if (row.inventoryItemId && !includedFree) {
      // A long rental takes the weekly cap, same as the rep's path —
      // otherwise a sandbag written in on a three-week job bills 21 days
      // where the identical quoted line bills 9.
      if (weeklyRateApplies(department, calDays)) {
        const cap = weeklyRateCap(department)
        if (cap) billableDays = computeBillableDays(calDays, cap)
      }
      const resolution = await resolveLineRate(
        {
          inventoryItemId: row.inventoryItemId,
          rateType,
          clientRate: 0,
          companyId: order.companyId,
        },
        tx,
      )
      // resolveLineRate returns the CATALOG/company rate whenever it can
      // price the item; it only echoes our 0 back when nothing priced it.
      if (resolution && resolution.resolvedRate && resolution.resolvedRate.greaterThan(0)) {
        rate = resolution.resolvedRate
        resolvedRate = resolution.resolvedRate
      } else {
        // The catalog row exists but carries no rate for this rate type
        // (MONTHLY/FLAT have no catalog source, and plenty of rows have
        // never been priced). Naming it was not enough; a person still
        // has to say what it costs.
        unpriced = true
      }
    }

    const lineTotal = computeLineTotal({
      quantity,
      rate: rate.toNumber(),
      billableDays,
      rateType,
      department,
    })

    const created = await tx.orderLineItem.create({
      data: {
        orderId: order.id,
        sortOrder: sortOrder++,
        type,
        description: row.description,
        inventoryItemId: row.inventoryItemId,
        pickupDate: pickup,
        returnDate: ret,
        rateType,
        rate,
        resolvedRate,
        rateOverridden: false,
        quantity,
        billableDays,
        computedDays: computeDays(pickup, ret),
        lineTotal: Math.round(lineTotal * 100) / 100,
        // The floor's own words survive onto the line, and onto the
        // paperwork. "3 batteries not in the case" is the whole value of
        // the row to whoever reads the order a week later.
        notes: row.note?.trim() || clientNote,
        department,
        warehouseAddedAt: at,
        warehouseAddedBy: preppedBy?.trim() || null,
        pricingPendingAt: unpriced ? at : null,
      },
      select: { id: true },
    })

    made.push({
      orderLineItemId: created.id,
      description: row.description,
      quantity,
      rate: unpriced ? null : rate.toNumber(),
      department,
      unpriced,
    })
  }

  return made
}
