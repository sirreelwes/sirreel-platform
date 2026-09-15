/**
 * "Sub walkies for this order" (DERIVED).
 *
 * Wes, 2026-09-15: "we should remove sub from the inventory, and instead
 * we should have HQ manage whether or not we need to sublease the walkies
 * from another company." The catalog's "(Sub)" radio made subbing a guess
 * a rep made on the quote. Now HQ counts the Motorola CP200 pool (analog
 * and digital stock together, lib/catalog/walkies.ts) against every
 * committed walkie line, day by day, and this is where a shortfall reaches
 * the desk while there is still time to call a vendor.
 *
 * Only COMMITTED orders escalate (registry ruling B). A sent quote holds
 * nothing, so "if every quote lands we're short" is advisory — it shows on
 * the order page and never becomes a task. Clears when a sub-rental covering
 * the gap is recorded on the order (subbed radios join the pool on their
 * dates), when the order shrinks, or when stock is added.
 */

import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ActionItem, ActionItemProvider, ProviderContext } from '@/lib/actionItems/types'
import { COMMITTED_STATUSES, loadWalkieBook, walkieSupplyForOrder } from '@/lib/catalog/walkiePool'

/** The desk books the sub-rental; the warehouse manager receives it. */
const OWNER: UserRole[] = ['ADMIN', 'MANAGER', 'AGENT']

/** A vendor needs notice — three weeks out is when it is still easy. */
const LOOKAHEAD_DAYS = 21

function fmtDay(d: string): string {
  return new Date(`${d}T00:00:00.000Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

export const walkiesShortProvider: ActionItemProvider = {
  id: 'walkies-short',
  kind: 'DERIVED',
  async fetch(_ctx: ProviderContext): Promise<ActionItem[]> {
    const book = await loadWalkieBook()
    if (book.lines.length === 0) return []

    const today = new Date().toISOString().slice(0, 10)
    const horizon = new Date(Date.now() + LOOKAHEAD_DAYS * 86_400_000).toISOString().slice(0, 10)

    const orderIds = [...new Set(
      book.lines
        .filter((l) => COMMITTED_STATUSES.includes(l.status) && l.start <= horizon)
        .map((l) => l.orderId),
    )]
    if (orderIds.length === 0) return []

    const short = orderIds
      .map((id) => ({ id, supply: walkieSupplyForOrder(book, id) }))
      .filter((r) => r.supply && r.supply.short > 0)
    if (short.length === 0) return []

    const orders = await prisma.order.findMany({
      where: { id: { in: short.map((r) => r.id) } },
      select: { id: true, orderNumber: true, job: { select: { name: true } } },
    })
    const byId = new Map(orders.map((o) => [o.id, o]))

    const items: ActionItem[] = []
    for (const { id, supply } of short) {
      const s = supply!
      const order = byId.get(id)
      if (!order || !s.peakDay) continue
      const first = book.lines
        .filter((l) => l.orderId === id)
        .reduce((min, l) => (l.start < min ? l.start : min), '9999-12-31')
      // Going out inside three days: the call to a vendor is today's.
      const soon = first <= new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
      items.push({
        id: `walkies-short:${id}:${s.short}`,
        type: 'walkies_short',
        title: `Sub ${s.short} walkie${s.short === 1 ? '' : 's'} — ${order.orderNumber}`,
        subtitle:
          `${order.job?.name || 'Unnamed job'} — ${fmtDay(s.peakDay)} needs ${s.bookedAtPeak} Motorola CP200s ` +
          `and we have ${s.pool}${s.subbedAtPeak ? ` + ${s.subbedAtPeak} subbed in` : ''}. ` +
          `Record the sub-rental on the order's walkie line.`,
        ownerRole: OWNER,
        priority: soon || first <= today ? 'high' : 'medium',
        href: `/orders/${id}`,
        occurredAt: new Date(`${first}T00:00:00.000Z`),
        source: 'walkies-short',
        dismissal: { kind: 'sideRow' },
      })
    }
    return items
  },
}
