/**
 * "The quote is out — now put the units on it" (DERIVED).
 *
 * Wes, 2026-09-03, after quoting High Horses (S260903-002): "In that is
 * information about the vehicles pick up and drop off times and yet I
 * don't think it auto populate on the reservation system. We need the
 * ability to immediately be reminded to place these vehicles on hold and
 * assigned specific units. I don't want that to slow down the quote
 * process, but I want it to be an immediate follow up after we sent the
 * quote."
 *
 * Sending a quote already creates a SOFT hold per category
 * (lib/orders/holdOnQuoteSend) — but a category hold is not a truck. It
 * reserves "a Cargo Van", reads as spoken-for in the capacity maths, and
 * shows up on NO unit row on the board, because the board draws
 * assignments. Until someone picks Cargo 38 the reservation is an
 * intention, and nothing anywhere asked them to.
 *
 * So this is the follow-up, and deliberately NOT a blocker: the quote
 * goes out at the speed it always did, and the item appears the instant
 * the agent next loads the board.
 *
 * ── What makes an item ─────────────────────────────────────────────
 *
 * A sent quote whose holds are not yet fully assigned to units, OR whose
 * quote carried a vehicle line the hold logic could not resolve at all.
 * The second is the more urgent of the two and is called out by name:
 * an unassigned hold is at least visible in the capacity count, while an
 * unresolved line ("Production Truck", a free-typed VEHICLES row with no
 * catalog link) reserves nothing whatsoever.
 *
 * ── Why it stops appearing ─────────────────────────────────────────
 *
 * It clears itself when every held item is ASSIGNED — the work being
 * done is what removes it, which is the only honest way for a reminder
 * to end. Dismissal is available for the judgement call ("this one is
 * subhired, leave it"), per-user via the side-row.
 *
 * ESCALATE-ONLY-THE-EXCEPTION (registry ruling B): a quote whose units
 * are all assigned never produces an item. This is the exception — the
 * thing the system could not finish on its own — not a log of every
 * quote sent.
 */

import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ACTIONABLE_ORDER_WHERE } from '@/lib/orders/actionableWhere'
import type { ActionItem, ActionItemProvider, ProviderContext } from '@/lib/actionItems/types'
import { isUnholdableVehicleLine } from '@/lib/orders/holdOnQuoteSend'

/** Sales own the follow-through on their own quote; dispatch and admin
 *  see all of them because assigning the unit is ultimately their call. */
const OWNER: UserRole[] = ['ADMIN', 'MANAGER', 'AGENT']

/** A quote sent longer ago than this is the aging provider's problem,
 *  not an "assign the units" nudge — by then the question is whether the
 *  deal is alive at all. */
const LOOKBACK_DAYS = 45

function fmtRange(start: Date | null, end: Date | null): string {
  if (!start) return ''
  const f = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return !end || +end === +start ? f(start) : `${f(start)}–${f(end)}`
}

export const holdUnassignedProvider: ActionItemProvider = {
  id: 'hold-unassigned',
  kind: 'DERIVED',
  async fetch(ctx: ProviderContext): Promise<ActionItem[]> {
    // OWN scope with no user → match nothing (safe default).
    if (ctx.scope === 'OWN' && !ctx.userId) return []
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000)

    const orders = await prisma.order.findMany({
      where: {
        quoteSentAt: { not: null, gte: since },
        ...ACTIONABLE_ORDER_WHERE,
        ...(ctx.scope === 'OWN' ? { agentId: ctx.userId! } : {}),
      },
      select: {
        id: true,
        orderNumber: true,
        quoteSentAt: true,
        company: { select: { name: true } },
        job: { select: { id: true, name: true } },
        // Vehicle lines that resolve to no category reserve NOTHING — no
        // hold row, so the counts below cannot see them. Read them from
        // the lines with the hold logic's own predicate.
        lineItems: {
          select: {
            description: true,
            quantity: true,
            department: true,
            assetCategoryId: true,
            assetCategory: { select: { department: true } },
            inventoryItem: {
              select: { department: true, trackingMode: true, legacyAssetCategoryId: true },
            },
          },
        },
        booking: {
          select: {
            startDate: true,
            endDate: true,
            items: {
              where: { status: { in: ['REQUESTED', 'ASSIGNED'] } },
              select: {
                quantity: true,
                status: true,
                category: { select: { name: true } },
                assignments: {
                  where: { status: { in: ['ASSIGNED', 'CHECKED_OUT'] } },
                  select: { id: true },
                },
              },
            },
          },
        },
      },
      orderBy: { quoteSentAt: 'desc' },
      take: 100,
    })

    const items: ActionItem[] = []
    for (const o of orders) {
      const holds = o.booking?.items ?? []
      const unheld = o.lineItems.filter(isUnholdableVehicleLine)
      // Nothing held AND nothing unholdable → not a vehicle quote at all.
      if (holds.length === 0 && unheld.length === 0) continue

      // Units still to pick. Count against QUANTITY, not row count — a
      // "2x Passenger Van" hold with one van assigned is half done, and
      // reporting it as done would be the same silence this fixes.
      let wanted = 0
      let assigned = 0
      const shortCategories: string[] = []
      for (const h of holds) {
        const q = h.quantity || 1
        wanted += q
        const got = Math.min(h.assignments.length, q)
        assigned += got
        if (got < q) shortCategories.push(`${q - got}× ${h.category.name}`)
      }
      if (assigned >= wanted && unheld.length === 0) continue

      const outstanding = wanted - assigned
      const when = fmtRange(o.booking?.startDate ?? null, o.booking?.endDate ?? null)
      const who = o.company?.name || o.job?.name || o.orderNumber
      const hoursOld = o.quoteSentAt
        ? Math.floor((Date.now() - o.quoteSentAt.getTime()) / 3_600_000)
        : 0

      const age = hoursOld < 24 ? `${hoursOld}h` : `${Math.floor(hoursOld / 24)}d`
      const heldPart =
        outstanding > 0
          ? `${outstanding} vehicle${outstanding === 1 ? '' : 's'} held but not on a unit${when ? ` (${when})` : ''}: ${shortCategories.join(', ')}`
          : ''
      // Named first when present: an unholdable line is worse than an
      // unassigned one — it is not reserved anywhere, at any grain.
      const unheldPart = unheld.length
        ? `NOT HELD AT ALL (no catalog match): ${unheld.map((l) => l.description || 'unnamed line').join(', ')}`
        : ''
      items.push({
        id: `hold-unassigned:${o.id}`,
        type: 'hold_unassigned',
        title: `Assign units — ${who}`,
        subtitle:
          `Quote ${o.orderNumber} went out ${age} ago. ` +
          [unheldPart, heldPart].filter(Boolean).join(' · '),
        ownerRole: OWNER,
        // The whole point is immediacy — a soft hold on no unit is what
        // lets the same truck go out twice.
        priority: 'high' as const,
        // Straight to the job's reservation, where units get picked.
        href: o.job?.id ? `/jobs/${o.job.id}#reservations` : `/orders/${o.id}`,
        occurredAt: o.quoteSentAt ?? new Date(),
        source: 'hold-unassigned',
        dismissal: { kind: 'sideRow' as const },
      })
    }
    return items
  },
}
