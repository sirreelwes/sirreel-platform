/**
 * "The kit is not on the order" (DERIVED).
 *
 * Wes, 2026-09-13, after the second walkie order in one week went out
 * with no antennas: "we need to make sure we have a workflow that
 * double-checks that the walkies, their antennas, their batteries, and
 * the spare batteries are all included in the rental."
 *
 * The supervisor's check-out sheet now refuses to file a short kit in one
 * tap (lib/orders/kitCompleteness) — but by then the crew is in the bay
 * and the fix is a scramble. This is the earlier half of the same
 * question, asked of the ORDER rather than the count: an upcoming rental
 * whose radios have no antenna line at all cannot be pulled correctly,
 * because the piece never prints on the sheet.
 *
 * ── Why an order can be short in the first place ───────────────────
 * `syncOrderKitPieces` adds the accessories on every line mutation, so a
 * new order is complete by construction. Two ways it isn't:
 *
 *   - the kit was configured AFTER the order was written. The reconciler
 *     deliberately counts only lines created at or after the kit row
 *     (Wes 2026-09-07: a rule must never re-price a quote that already
 *     went out), so attaching antennas today leaves yesterday's booked
 *     radios untouched — correct about money, and exactly the gear that
 *     then leaves incomplete;
 *   - the accessory line was deleted by hand after the fact.
 *
 * Both are invisible on the order itself. This is what makes them
 * visible, while there is still time to load the shelf.
 *
 * ESCALATE-ONLY-THE-EXCEPTION (registry ruling B): an order whose kit is
 * complete — every order the reconciler touched — produces no item.
 */

import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ActionItem, ActionItemProvider, ProviderContext } from '@/lib/actionItems/types'
import { buildKitExpectations, loadKitRules } from '@/lib/orders/kitExpectations'
import { kitShortfalls, type CountedQuantities } from '@/lib/orders/kitCompleteness'

/** The warehouse packs it, the desk owns what is on the order. */
const OWNER: UserRole[] = ['ADMIN', 'MANAGER', 'AGENT']

/** How far ahead to look. Far enough to fix it, near enough to matter. */
const SOON_DAYS = 7

/** Alive and still going out. A returned or cancelled order packs nothing. */
const LIVE_STATUSES = [
  'DRAFT', 'QUOTE_SENT', 'APPROVED', 'BOOKED', 'LOADED_READY',
] as const

export const kitIncompleteProvider: ActionItemProvider = {
  id: 'kit-incomplete',
  kind: 'DERIVED',
  async fetch(_ctx: ProviderContext): Promise<ActionItem[]> {
    // One read of the (small) rule table for the whole sweep, rather
    // than one per order in a provider that runs on every page load.
    const rules = await loadKitRules()
    if (rules.length === 0) return []

    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const until = new Date(today.getTime() + SOON_DAYS * 86_400_000)

    const orders = await prisma.order.findMany({
      where: {
        status: { in: [...LIVE_STATUSES] },
        startDate: { gte: today, lte: until },
        quoteStatus: { not: 'LOST' },
        job: { status: { not: 'LOST' }, archivedAt: null },
      },
      select: {
        id: true,
        orderNumber: true,
        startDate: true,
        job: { select: { name: true } },
        lineItems: { select: { id: true, inventoryItemId: true, quantity: true } },
      },
      orderBy: { startDate: 'asc' },
      take: 300,
    })

    const items: ActionItem[] = []
    for (const order of orders) {
      const expectations = buildKitExpectations(order.lineItems, rules)
      if (expectations.length === 0) continue

      // "Counted" here is what the ORDER says — the question is whether
      // the paperwork is complete, before anyone counts anything.
      const counted: CountedQuantities = {}
      for (const l of order.lineItems) counted[l.id] = l.quantity

      const short = kitShortfalls(expectations, counted)
      if (short.length === 0) continue

      const names = short.map((s) => s.pieceDescription)
      const starts = order.startDate
      // Out within 48 hours and the shelf has not been pulled yet — past
      // that point the sheet is printed and the fix costs someone a trip.
      const urgent = !!starts && starts.getTime() <= today.getTime() + 2 * 86_400_000

      items.push({
        id: `kit-incomplete:${order.id}`,
        type: 'kit_incomplete',
        title: `${order.orderNumber} is missing ${names.length === 1 ? names[0] : `${names.length} kit pieces`}`,
        subtitle:
          `${order.job?.name || 'Unnamed job'} — ` +
          short.map((s) => `${s.counted} of ${s.expected} ${s.pieceDescription}`).join(', ') +
          '. Add the line before the sheet prints, or the floor has nothing to pull.',
        ownerRole: OWNER,
        priority: urgent ? 'high' : 'medium',
        href: `/orders/${order.id}`,
        occurredAt: starts ?? today,
        dueAt: starts ?? null,
        source: 'kit-incomplete',
        dismissal: { kind: 'sideRow' },
      })
    }

    return items
  },
}
