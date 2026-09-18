/**
 * Replacement-cost provider (DERIVED). A catalog row that is going out on an
 * upcoming order with no replacement cost on file — so the order cannot tell
 * the client's broker what to insure it for.
 *
 * The unit is a CATALOG ROW, not an order. Pricing the row is the fix,
 * and one row (a cube truck, a walkie kit) is usually what is holding up a
 * dozen orders at once; a dozen order-shaped items would say the same thing
 * twelve times and hide the one edit that clears them all.
 *
 * THREE SHAPES (Wes 2026-09-17: "Replacement cost to add · 71" was the
 * whole catalog-pricing backlog from launch, read as 71 tasks):
 *   - a VEHICLE row going out inside REPLACEMENT_URGENT_DAYS is its OWN
 *     high item (`replacement-cost:item:<id>`, same key as before, so a
 *     dismissal survives) — a truck is the bulk of any order's exposure;
 *   - every other catalog row folds into ONE low/medium backlog item
 *     (`replacement-cost:backlog`) that links to the pricing wizard's
 *     "on upcoming orders" queue, soonest pickup first;
 *   - free-typed lines (no catalog row) fold into ONE agent item
 *     (`replacement-cost:free-typed`) — the fix is on the order, not in
 *     the catalog. Split in rules.ts (`splitReplacementGroups`).
 *
 * The backlog's dismissal key is fixed, so "Mark handled" hides the chore
 * for that user until they clear it — the count changing does not bring it
 * back. The urgent rows still surface on their own.
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
import {
  priorityForBacklog,
  replacementBacklogSubtitle,
  splitReplacementGroups,
  startOfUtcDay,
  type ReplacementGroupInput,
} from '@/lib/actionItems/rules'

const CATALOG_OWNER: UserRole[] = ['ADMIN', 'MANAGER']
const LINE_OWNER: UserRole[] = ['ADMIN', 'MANAGER', 'AGENT']

/** The wizard queue the backlog item opens: rows with no cost, on an
 *  upcoming order, soonest pickup first (`?upcoming=1` on the items API). */
export const REPLACEMENT_BACKLOG_HREF = '/inventory/wizard?view=value&upcoming=1'

type OrderRef = { id: string; orderNumber: string; startDate: Date | null; jobId: string | null }

export const replacementCostMissingProvider: ActionItemProvider = {
  id: 'replacement-cost-missing',
  kind: 'DERIVED',
  async fetch(_ctx: ProviderContext): Promise<ActionItem[]> {
    const today = startOfUtcDay()

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

    type Group = ReplacementGroupInput & { row: ReplacementLine; refs: OrderRef[] }
    const inputs: Group[] = Array.from(groups.values()).map((g) => {
      const refs = Array.from(g.orders.values())
      const soonest = refs.reduce<Date | null>((d, r) => (r.startDate && (!d || r.startDate < d) ? r.startDate : d), null)
      return {
        key: g.key,
        inventoryItemId: g.row.inventoryItemId,
        type: g.row.type,
        description: g.row.description,
        partner: g.partner,
        soonest,
        orderCount: refs.length,
        row: g.row,
        refs,
      }
    })
    const { urgent, catalogBacklog, freeTyped } = splitReplacementGroups(inputs, today)

    const items: ActionItem[] = []
    const numbersOf = (refs: OrderRef[]) =>
      refs.slice(0, 3).map((r) => r.orderNumber).join(', ') + (refs.length > 3 ? `, +${refs.length - 3}` : '')
    const countOf = (refs: OrderRef[]) => `${refs.length} upcoming order${refs.length === 1 ? '' : 's'}`

    // A VEHICLE row going out within the week: its own HIGH item, same key
    // as before the fold so an existing dismissal still matches.
    for (const g of urgent) {
      items.push({
        id: `replacement-cost:${g.key}`,
        type: 'replacement_cost_missing',
        title: `Add a replacement cost — ${g.description}`,
        subtitle:
          `${countOf(g.refs)} (${numbersOf(g.refs)}) can't tell the client's broker what to insure it for` +
          (g.partner ? ' — a partner’s unit; ask them for the figure' : ''),
        ownerRole: CATALOG_OWNER,
        priority: 'high',
        href: `/inventory?item=${g.inventoryItemId}`,
        occurredAt: g.soonest ?? today,
        dueAt: g.soonest,
        source: 'replacement-cost-missing',
        dismissal: { kind: 'sideRow' },
      })
    }

    // Every other catalog row: one chore, one item.
    if (catalogBacklog.length > 0) {
      const soonest = catalogBacklog[0].soonest
      items.push({
        id: 'replacement-cost:backlog',
        type: 'replacement_cost_backlog',
        title: `Add replacement costs — ${catalogBacklog.length} catalog row${catalogBacklog.length === 1 ? '' : 's'}`,
        subtitle: replacementBacklogSubtitle(catalogBacklog, today),
        ownerRole: CATALOG_OWNER,
        priority: priorityForBacklog(catalogBacklog, today),
        href: REPLACEMENT_BACKLOG_HREF,
        occurredAt: soonest ?? today,
        dueAt: soonest,
        source: 'replacement-cost-missing',
        dismissal: { kind: 'sideRow' },
      })
    }

    // Free-typed lines: the agent's to link to a real row. One item, the
    // orders named, linking to the soonest one.
    if (freeTyped.length > 0) {
      const refsById = new Map<string, OrderRef>()
      for (const g of freeTyped) for (const r of g.refs) refsById.set(r.id, r)
      const refs = Array.from(refsById.values()).sort(
        (a, b) => (a.startDate?.getTime() ?? Infinity) - (b.startDate?.getTime() ?? Infinity),
      )
      const soonest = freeTyped[0].soonest
      items.push({
        id: 'replacement-cost:free-typed',
        type: 'replacement_cost_free_typed',
        title: `Link ${freeTyped.length} free-typed line${freeTyped.length === 1 ? '' : 's'} to the catalog`,
        subtitle:
          `${freeTyped.length === 1 ? 'A line' : 'Lines'} typed by hand on ${countOf(refs)} (${numbersOf(refs)}) ` +
          `can't be valued — link ${freeTyped.length === 1 ? 'it' : 'each'} to a catalog row, or price the row`,
        ownerRole: LINE_OWNER,
        priority: priorityForBacklog(freeTyped, today),
        href: `/orders/${refs[0].id}`,
        occurredAt: soonest ?? today,
        dueAt: soonest,
        source: 'replacement-cost-missing',
        dismissal: { kind: 'sideRow' },
      })
    }

    return items
  },
}
