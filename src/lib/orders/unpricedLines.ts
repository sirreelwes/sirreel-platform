/**
 * Lines nobody has priced yet — the gate that makes a warehouse-added
 * line safe to have on an order at all.
 *
 * The 2026-09-03 rule refused warehouse-added lines outright because the
 * yard cannot see rates and "a $0 line would silently under-bill the
 * job". The operative word in that sentence is SILENTLY. A line at zero
 * that nobody can see is a hole in an invoice; a line at zero that STOPS
 * the invoice is a to-do. This module is what turns the first into the
 * second, and it is the reason the refusal could be lifted on 2026-09-14
 * (see lib/orders/warehouseAddedLines.ts).
 *
 * Two callers hold the money, and both must consult it:
 *
 *   · generateRentalInvoice — refuses outright. An invoice cut over an
 *     unpriced line bills the client zero for gear that went out, and
 *     `Invoice.total` is canonical once it exists.
 *   · resendQuoteOnChange — declines to email. The corrected quote is the
 *     document the client is asked to approve; a $0 line on it reads as
 *     "free", and once they have seen that, pricing it afterwards is a
 *     conversation nobody wants to have.
 *
 * It is deliberately NOT a gate on the check report itself. The sheet is
 * a record of what physically happened and must always be fileable — the
 * gear is on a truck whether or not anyone has priced it, and refusing
 * the filing would lose the record to protect the invoice.
 */

import { prisma } from '@/lib/prisma'

export interface UnpricedLine {
  id: string
  description: string
  quantity: number
  /** Who put it on the order, when it was the warehouse. */
  addedBy: string | null
  pendingSince: Date
}

/** Every line on the order still waiting for a price, oldest first. */
export async function unpricedLinesFor(orderId: string): Promise<UnpricedLine[]> {
  const rows = await prisma.orderLineItem.findMany({
    where: { orderId, pricingPendingAt: { not: null } },
    select: {
      id: true, description: true, quantity: true,
      warehouseAddedBy: true, pricingPendingAt: true,
    },
    orderBy: { pricingPendingAt: 'asc' },
  })
  return rows.map((r) => ({
    id: r.id,
    description: r.description,
    quantity: r.quantity,
    addedBy: r.warehouseAddedBy,
    // Non-null by the where-clause; narrowed for the caller.
    pendingSince: r.pricingPendingAt as Date,
  }))
}

/**
 * One sentence naming what is blocking, for a refusal message or a
 * banner. Null when nothing is pending — callers can use it directly as
 * the gate.
 */
export function unpricedReason(lines: UnpricedLine[]): string | null {
  if (lines.length === 0) return null
  const names = lines.slice(0, 3).map((l) => `${l.quantity}× ${l.description}`).join(', ')
  const more = lines.length > 3 ? `, and ${lines.length - 3} more` : ''
  return `${lines.length} line${lines.length === 1 ? '' : 's'} on this order ${
    lines.length === 1 ? 'has' : 'have'
  } no price yet — ${names}${more}. The warehouse added ${
    lines.length === 1 ? 'it' : 'them'
  } at check-out and could not name ${
    lines.length === 1 ? 'it' : 'them'
  } from the catalog, so an agent has to price ${lines.length === 1 ? 'it' : 'them'} first.`
}

/** Convenience for the two money callers. */
export async function unpricedBlock(orderId: string): Promise<string | null> {
  return unpricedReason(await unpricedLinesFor(orderId))
}
