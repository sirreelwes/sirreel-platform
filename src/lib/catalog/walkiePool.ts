/**
 * HQ decides when walkies need subbing — the loader half.
 *
 * The retired "(Sub)" catalog row made subbing something a rep CHOSE on
 * the quote, with nothing checking whether we were actually out of radios
 * (Wes 2026-09-15: "have HQ manage whether or not we need to sublease the
 * walkies"). This reads the whole walkie book once and hands it to the pure
 * `walkieShortfall` in walkies.ts, which answers per order.
 *
 * Supply = qtyOwned across the stock rows (analog + digital) plus radios
 * sub-rented in (a SubRental on a walkie line or naming a walkie row, not
 * cancelled). Demand = walkie lines on live orders, over each line's own
 * pickup→return days. Kit-piece lines never count — they are batteries and
 * chargers, not radios.
 *
 * Internal only. Nothing here reaches a client serializer, and the client
 * never learns that a radio on their order was subbed.
 */

import type { OrderStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  WALKIE_FAMILY_CODES,
  WALKIE_NAME,
  WALKIE_ORDER_CODE,
  isStockOnlyCode,
  isWalkieFamilyCode,
  walkieShortfall,
  type WalkieDemand,
  type WalkieShortfall,
  type WalkieSubIn,
} from '@/lib/catalog/walkies'

/** Holding radios: the client said yes, or they are already out. */
export const COMMITTED_STATUSES: OrderStatus[] = ['APPROVED', 'BOOKED', 'LOADED_READY', 'ON_JOB']
/** Not holding yet. A sent quote would if it lands; a draft only answers for itself. */
export const QUOTED_STATUSES: OrderStatus[] = ['DRAFT', 'QUOTE_SENT']

type Db = Prisma.TransactionClient | typeof prisma

function day(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

export interface WalkieOrderLine {
  id: string
  orderId: string
  orderNumber: string
  status: OrderStatus
  description: string
  quantity: number
  rate: number
  start: string
  end: string
}

export interface WalkieBook {
  pool: number
  /** The row lines bind to — null only if the catalog lost it. */
  orderItemId: string | null
  familyItemIds: string[]
  lines: WalkieOrderLine[]
  demands: WalkieDemand[]
  subs: WalkieSubIn[]
}

/**
 * Every live walkie line whose days reach `from` or later. Past rentals
 * cannot be short any more, and reading them would only slow the sweep.
 */
export async function loadWalkieBook(opts: { from?: Date; db?: Db } = {}): Promise<WalkieBook> {
  const db = opts.db ?? prisma
  const from = opts.from ?? new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z')

  const family = await db.inventoryItem.findMany({
    where: { code: { in: [...WALKIE_FAMILY_CODES] }, isActive: true },
    select: { id: true, code: true, qtyOwned: true },
  })
  const familyItemIds = family.map((f) => f.id)
  const orderItemId = family.find((f) => f.code === WALKIE_ORDER_CODE)?.id ?? null
  const pool = family.reduce((n, f) => n + Math.max(0, f.qtyOwned), 0)
  if (familyItemIds.length === 0) {
    return { pool: 0, orderItemId: null, familyItemIds, lines: [], demands: [], subs: [] }
  }

  const rows = await db.orderLineItem.findMany({
    where: {
      inventoryItemId: { in: familyItemIds },
      autoKitPieceId: null,
      quantity: { gt: 0 },
      returnDate: { gte: from },
      order: {
        status: { in: [...COMMITTED_STATUSES, ...QUOTED_STATUSES] },
        quoteStatus: { not: 'LOST' },
      },
    },
    select: {
      id: true, description: true, quantity: true, rate: true,
      pickupDate: true, returnDate: true,
      order: { select: { id: true, orderNumber: true, status: true } },
    },
  })

  const lines: WalkieOrderLine[] = []
  for (const r of rows) {
    const start = day(r.pickupDate)
    const end = day(r.returnDate)
    if (!start || !end) continue
    lines.push({
      id: r.id,
      orderId: r.order.id,
      orderNumber: r.order.orderNumber,
      status: r.order.status,
      description: r.description,
      quantity: r.quantity,
      rate: Number(r.rate),
      start,
      end,
    })
  }

  const demands: WalkieDemand[] = lines.map((l) => ({
    orderId: l.orderId,
    quantity: l.quantity,
    start: l.start,
    end: l.end,
    hold: COMMITTED_STATUSES.includes(l.status) ? 'committed' : l.status === 'QUOTE_SENT' ? 'quoted' : 'draft',
  }))

  const subRows = await db.subRental.findMany({
    where: {
      status: { not: 'CANCELLED' },
      OR: [
        { inventoryItemId: { in: familyItemIds } },
        { orderLineItem: { inventoryItemId: { in: familyItemIds } } },
      ],
    },
    select: {
      quantity: true, startDate: true, endDate: true,
      orderLineItem: { select: { pickupDate: true, returnDate: true } },
    },
  })
  const subs: WalkieSubIn[] = []
  for (const s of subRows) {
    // A sub with no dates of its own covers the line it was booked for.
    const start = day(s.startDate) ?? day(s.orderLineItem?.pickupDate)
    const end = day(s.endDate) ?? day(s.orderLineItem?.returnDate)
    if (!start || !end) continue
    subs.push({ quantity: s.quantity, start, end })
  }

  return { pool, orderItemId, familyItemIds, lines, demands, subs }
}

export interface OrderWalkieSupply extends WalkieShortfall {
  walkieQty: number
  /** The line a sub-rental should hang off — the biggest walkie line. */
  line: WalkieOrderLine | null
}

/** One order's answer, from a book loaded once. */
export function walkieSupplyForOrder(book: WalkieBook, orderId: string): OrderWalkieSupply | null {
  const mine = book.lines.filter((l) => l.orderId === orderId)
  if (mine.length === 0) return null
  const result = walkieShortfall({
    pool: book.pool,
    orderId,
    demands: book.demands,
    subs: book.subs,
  })
  const line = [...mine].sort((a, b) => b.quantity - a.quantity)[0] ?? null
  return {
    ...result,
    walkieQty: mine.reduce((n, l) => n + l.quantity, 0),
    line,
  }
}

/**
 * A line about to be written, made to say what Wes wants it to say: bound
 * to the "Motorola CP200" row whichever radio row the caller named, and
 * described as "Motorola CP200" rather than "analog walkies" or "(Digital)".
 * Every other line comes back untouched, for the price of one indexed read.
 *
 * Called by the routes that CREATE lines from a caller-supplied item
 * (line-items POST, from-parse). The pickers and the matcher never offer a
 * stock-only row in the first place; this is what catches a stale client,
 * a reorder of an old line, or a hand-built request.
 */
export async function orderableWalkieLine<T extends { inventoryItemId?: string | null; description?: string | null }>(
  line: T,
  db: Db = prisma,
): Promise<T> {
  if (!line.inventoryItemId) return line
  const item = await db.inventoryItem.findUnique({
    where: { id: line.inventoryItemId },
    select: { code: true },
  })
  if (!item || !isWalkieFamilyCode(item.code)) return line
  let inventoryItemId = line.inventoryItemId
  if (isStockOnlyCode(item.code)) {
    const target = await db.inventoryItem.findFirst({
      where: { code: WALKIE_ORDER_CODE, isActive: true },
      select: { id: true },
    })
    if (target) inventoryItemId = target.id
  }
  return { ...line, inventoryItemId, description: WALKIE_NAME }
}
