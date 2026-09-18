/**
 * Gear added to an order the warehouse has ALREADY pulled.
 *
 * Wes, 2026-09-18: "We had an order out to a client, and mid-job they
 * wanted to add some items. We sent the pick list to the warehouse, and
 * when they went to do the checkout process, the system showed that the
 * items were already staged and ready. That's a miss. Even though it's
 * added to an existing order, the pull process and checkout process need
 * to be as if it was a new order for our warehouse."
 *
 * What went wrong: the check-out sheet pre-fills a line that no filed
 * report has a row for exactly like a line the crew counted — full
 * quantity, no byline, no difference on screen. Everything downstream
 * then reads the order as pulled: the pick list keeps whatever terminal
 * status it reached, the order keeps LOADED_READY / ON_JOB, and the row
 * on /reports/orders reads a green "Filed". The gear is still on the
 * shelf and nothing says so.
 *
 * THE ANCHOR IS THE FILED SHEET, NOT A TIMESTAMP. When a check report is
 * filed, EVERY line that existed at that moment gets a row on it — the
 * ones that were counted and the ones a partial pull deliberately left
 * for later (onSheet: false). So a line with no row on the sheet is a
 * line the sheet never spoke to: it was added afterwards, and nobody has
 * pulled it. Comparing OrderLineItem.createdAt against submittedAt would
 * answer the same question most of the time and get it wrong in the one
 * case that matters — a line added while the supervisor had the form
 * open, which files without it and would otherwise look counted.
 *
 * The two ideas stay separate and compose: "left for a later pull"
 * (a row, onSheet false) is the first pull unfinished; "added after the
 * pull" (no row at all) is new work on a finished one. A line can never
 * be both.
 *
 * Read it through here — never re-derive it. Surfaces that do:
 *   - the check-out / check-in sheet (checkReports.reportDraft), where an
 *     added line starts UNCOUNTED like a fresh sheet's line
 *   - the /reports/orders queue row, which stops saying Filed
 *   - the pull sheet PDF + the picking queue at /warehouse/pick
 *   - the pull order email (sendPullOrder), which names what is new
 */

import type { OrderStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isPickableLine } from '@/lib/orders/lineType'

/** The filed sheet, reduced to what this question needs. */
export interface FiledSheet {
  submittedAt: Date
  /** Every OrderCheckReportLine's orderLineItemId. Nulls are the rows
   *  the warehouse wrote in that never became order lines. */
  lineIds: ReadonlyArray<string | null>
}

/**
 * The pure rule. Lines the filed sheet has no row for — in order.
 * No sheet on file means nothing has been pulled yet, so nothing was
 * "added after" it: the whole order is the pull.
 *
 * EXCEPT the floor's own additions. A check-out add-on — the straps and
 * pads a driver asks for at the truck (checkoutAddOns.ts) — also lands
 * after the sheet is filed, and it is already loaded: the warehouse put
 * it there. `warehouseAddedAt` is required on the input rather than
 * optional so a caller cannot forget to select it and quietly send the
 * floor back out for gear that left with the truck. Measured on live
 * data 2026-09-18: 3 of the 4 orders this rule matched were exactly
 * that (ratchet straps, furniture pads, bungees).
 */
export function addedAfterPull<L extends { id: string; warehouseAddedAt: Date | null }>(
  lines: readonly L[],
  sheet: FiledSheet | null,
): L[] {
  if (!sheet) return []
  const spokenFor = new Set(sheet.lineIds.filter((id): id is string => !!id))
  return lines.filter((l) => !spokenFor.has(l.id) && l.warehouseAddedAt == null)
}

/**
 * Statuses where the question "does somebody still have to pull this?"
 * has an answer. Once the truck is back (RETURNED and beyond) an added
 * line is a billing correction, not a pull — flagging it would put
 * permanent red on the picking floor for gear nobody will ever fetch.
 * Measured 2026-09-18: every historical match on the live DB but one was
 * a closed, invoiced or returned order.
 */
export const PULLABLE_ORDER_STATUSES: readonly OrderStatus[] = [
  'DRAFT', 'QUOTE_SENT', 'APPROVED', 'BOOKED', 'LOADED_READY', 'ON_JOB',
]

export function stillPullable(status: string | null | undefined): boolean {
  return !!status && (PULLABLE_ORDER_STATUSES as readonly string[]).includes(status)
}

export interface AddedLine {
  id: string
  description: string
  quantity: number
  type: string
  fulfillmentLane: string | null
  createdAt: Date
  /** Non-null = the warehouse put this line on itself, at the truck. */
  warehouseAddedAt: Date | null
}

export interface AddedAfterPullResult {
  /** When the warehouse's check-out sheet was filed. Null = never. */
  pulledAt: Date | null
  /** Every order line added since. */
  lines: AddedLine[]
  /** Just what somebody has to walk out and pull — fees, discounts and
   *  labor have nothing on a shelf. */
  gear: AddedLine[]
}

const NOTHING: AddedAfterPullResult = { pulledAt: null, lines: [], gear: [] }

/**
 * Batched — one pair of queries for a whole queue. Orders with no filed
 * check-out sheet are absent from the map; read misses as "nothing
 * added" (`?? NOTHING` via `addedFor`).
 */
export async function addedAfterPullForOrders(
  orderIds: string[],
): Promise<Map<string, AddedAfterPullResult>> {
  const out = new Map<string, AddedAfterPullResult>()
  const ids = [...new Set(orderIds.filter(Boolean))]
  if (ids.length === 0) return out

  // The OUT edge is the pull. A check-in sheet says what came back and
  // has nothing to do with whether the floor still owes somebody gear.
  const reports = await prisma.orderCheckReport.findMany({
    where: {
      orderId: { in: ids },
      edge: 'OUT',
      // Only orders that can still have gear walked out to them.
      order: { status: { in: [...PULLABLE_ORDER_STATUSES] } },
    },
    select: {
      orderId: true,
      submittedAt: true,
      lines: { select: { orderLineItemId: true } },
    },
  })
  if (reports.length === 0) return out

  const filed = new Map<string, FiledSheet>(
    reports.map((r) => [
      r.orderId,
      { submittedAt: r.submittedAt, lineIds: r.lines.map((l) => l.orderLineItemId) },
    ]),
  )

  const lines = await prisma.orderLineItem.findMany({
    where: { orderId: { in: [...filed.keys()] } },
    select: {
      id: true, orderId: true, description: true, quantity: true,
      type: true, fulfillmentLane: true, createdAt: true, sortOrder: true,
      warehouseAddedAt: true,
    },
    orderBy: { sortOrder: 'asc' },
  })

  const byOrder = new Map<string, AddedLine[]>()
  for (const l of lines) {
    const arr = byOrder.get(l.orderId) ?? []
    arr.push({
      id: l.id,
      description: l.description,
      quantity: l.quantity,
      type: l.type,
      fulfillmentLane: l.fulfillmentLane,
      createdAt: l.createdAt,
      warehouseAddedAt: l.warehouseAddedAt,
    })
    byOrder.set(l.orderId, arr)
  }

  for (const [orderId, sheet] of filed) {
    const added = addedAfterPull(byOrder.get(orderId) ?? [], sheet)
    out.set(orderId, {
      pulledAt: sheet.submittedAt,
      lines: added,
      gear: added.filter(isPickableLine),
    })
  }
  return out
}

/** One order's worth. */
export async function addedAfterPullForOrder(orderId: string): Promise<AddedAfterPullResult> {
  const map = await addedAfterPullForOrders([orderId])
  return map.get(orderId) ?? NOTHING
}

/** Map lookup with the right default — a missing key means no sheet. */
export function addedFor(
  map: Map<string, AddedAfterPullResult>,
  orderId: string,
): AddedAfterPullResult {
  return map.get(orderId) ?? NOTHING
}
