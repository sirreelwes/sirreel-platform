/**
 * Replacement-cost provider (DERIVED). A catalog row that is going out on an
 * upcoming order with no replacement cost on file — so the order cannot tell
 * the client's broker what to insure it for.
 *
 * The item is per CATALOG ROW, not per order. Pricing the row is the fix,
 * and one row (a cube truck, a walkie kit) is usually what is holding up a
 * dozen orders at once; a dozen order-shaped items would say the same thing
 * twelve times and hide the one edit that clears them all. Lines with no
 * catalog row at all (free-typed) are grouped by wording and link to the
 * order instead, since the fix there is to link the line to a real row.
 *
 * Only orders that have not ended yet qualify. Gear that has come back is
 * not anyone's exposure, and the figure was for the certificate that was
 * needed before it went out.
 *
 * Owner roles: the catalog is the manager's and admin's to price; a
 * free-typed line is the agent's to link. (Wes 2026-09-11.)
 */

import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ActionItem, ActionItemProvider, ProviderContext } from '@/lib/actionItems/types'
import {
  deriveReplacementValue,
  LIVE_ORDER_STATUSES,
  REPLACEMENT_LINE_SELECT,
  type ReplacementLine,
} from '@/lib/coi/replacementValue'

const CATALOG_OWNER: UserRole[] = ['ADMIN', 'MANAGER']
const LINE_OWNER: UserRole[] = ['ADMIN', 'MANAGER', 'AGENT']
const SOON_DAYS = 7

type OrderRef = { id: string; orderNumber: string; startDate: Date | null; jobId: string | null }

export const replacementCostMissingProvider: ActionItemProvider = {
  id: 'replacement-cost-missing',
  kind: 'DERIVED',
  async fetch(_ctx: ProviderContext): Promise<ActionItem[]> {
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)

    const orders = await prisma.order.findMany({
      where: {
        status: { in: [...LIVE_ORDER_STATUSES] },
        OR: [{ endDate: null }, { endDate: { gte: today } }],
        job: { status: { not: 'LOST' }, archivedAt: null },
      },
      select: {
        id: true,
        orderNumber: true,
        startDate: true,
        jobId: true,
        lineItems: { select: REPLACEMENT_LINE_SELECT },
      },
      orderBy: { startDate: 'asc' },
      take: 400,
    })

    // The register (RentalWorks per-unit costs) rescues most unpriced rows;
    // ask it once for every candidate row rather than once per order.
    const candidateRows = Array.from(
      new Set(
        orders.flatMap((o) =>
          o.lineItems
            .filter((l) => l.inventoryItem && !(l.inventoryItem.replacementCost && Number(l.inventoryItem.replacementCost) > 0))
            .map((l) => l.inventoryItem!.id),
        ),
      ),
    )
    const register = new Map<string, number>()
    if (candidateRows.length > 0) {
      const rows = await prisma.inventoryUnit.groupBy({
        by: ['inventoryItemId'],
        where: { inventoryItemId: { in: candidateRows }, inactive: false, replacementCost: { gt: 0 } },
        _max: { replacementCost: true },
      })
      for (const r of rows) {
        if (r.inventoryItemId && r._max.replacementCost) register.set(r.inventoryItemId, Number(r._max.replacementCost))
      }
    }

    // Vehicle classes: the dearest active unit in the class stands in when
    // no unit is bound yet. Reserved-unit values are not consulted here —
    // a row that is priced only by one truck's fleet record is still a row
    // the catalog should carry a cost for.
    const categoryIds = Array.from(
      new Set(
        orders.flatMap((o) =>
          o.lineItems.map((l) => l.assetCategoryId ?? l.inventoryItem?.legacyAssetCategoryId).filter((c): c is string => !!c),
        ),
      ),
    )
    const fleetAssets =
      categoryIds.length > 0
        ? await prisma.asset.findMany({
            where: { categoryId: { in: categoryIds }, isActive: true },
            select: { categoryId: true, currentValue: true, purchasePrice: true },
          })
        : []

    // Group the missing lines by what fixes them.
    const groups = new Map<string, { key: string; row: ReplacementLine; orders: Map<string, OrderRef>; partner: boolean }>()
    for (const o of orders) {
      const lines = o.lineItems.map((l) => ({
        ...l,
        inventoryItem: l.inventoryItem
          ? { ...l.inventoryItem, registerCost: register.get(l.inventoryItem.id) ?? null }
          : null,
      }))
      const summary = deriveReplacementValue(lines, { fleetAssets })
      for (const m of summary.missing) {
        const key = m.inventoryItemId ? `item:${m.inventoryItemId}` : `line:${m.description.trim().toLowerCase()}`
        const g = groups.get(key) ?? { key, row: m, orders: new Map<string, OrderRef>(), partner: m.partner }
        g.orders.set(o.id, { id: o.id, orderNumber: o.orderNumber, startDate: o.startDate, jobId: o.jobId })
        g.partner = g.partner && m.partner
        groups.set(key, g)
      }
    }

    const soonCutoff = new Date(today.getTime() + SOON_DAYS * 86_400_000)
    const items: ActionItem[] = []
    for (const g of groups.values()) {
      const refs = Array.from(g.orders.values())
      const soonest = refs.reduce<Date | null>((d, r) => (r.startDate && (!d || r.startDate < d) ? r.startDate : d), null)
      // High = a VEHICLE row going out within the week. A truck is the bulk
      // of any order's exposure; an unpriced power strip on the same order
      // is a medium, or 59 rows all shout at once (measured 2026-09-11).
      const soon = !!soonest && soonest <= soonCutoff && g.row.type === 'VEHICLE'
      const numbers = refs.slice(0, 3).map((r) => r.orderNumber).join(', ') + (refs.length > 3 ? `, +${refs.length - 3}` : '')
      const count = `${refs.length} upcoming order${refs.length === 1 ? '' : 's'}`
      const catalog = !!g.row.inventoryItemId

      items.push({
        id: `replacement-cost:${g.key}`,
        type: 'replacement_cost_missing',
        title: `Add a replacement cost — ${g.row.description}`,
        subtitle: catalog
          ? `${count} (${numbers}) can't tell the client's broker what to insure it for` +
            (g.partner ? ' — a partner’s unit; ask them for the figure' : '')
          : `${count} (${numbers}) — a free-typed line; link it to a catalog row, or price the row`,
        ownerRole: catalog ? CATALOG_OWNER : LINE_OWNER,
        priority: soon ? 'high' : 'medium',
        href: catalog ? `/inventory?item=${g.row.inventoryItemId}` : `/orders/${refs[0].id}`,
        occurredAt: soonest ?? today,
        source: 'replacement-cost-missing',
        dismissal: { kind: 'sideRow' },
      })
    }

    // Soonest exposure first inside the group; the registry re-sorts by priority.
    items.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    return items
  },
}
