/**
 * DOT-sheet provider (DERIVED). An upcoming order whose vehicles are picked
 * but whose DOT record has blanks, so the client's sheet is being WITHHELD.
 *
 * This item is the other half of making the sheet automatic (2026-09-17). A
 * complete record now publishes itself the moment the trucks are assigned —
 * nobody presses anything. The cost of that is silence in the one case that
 * matters: an incomplete record also says nothing, and "the client just never
 * got it" is exactly the failure the manual button was hiding. So the
 * withholding is what escalates.
 *
 * ESCALATE-ONLY-THE-EXCEPTION (ruling B): an order whose sheet published by
 * itself is the system doing its job and produces no item. Only the blocked
 * ones appear, and each one names the unit and the fields, because the fix is
 * a fleet edit on a specific truck — not anything the agent can do from the
 * order.
 *
 * ONE ITEM PER ORDER, not per unit: the sheet is withheld as a whole, so the
 * unblocking is "finish these three trucks", and three items would each read
 * as a separate thing to do while clearing none of them on its own.
 *
 * Owner roles: fleet's record to fill (Julian, Chris) plus the manager and
 * admin who can also edit a unit. The agent is deliberately NOT here — they
 * cannot fix a missing VIN, and it would sit in their "mine" tab forever.
 */

import type { OrderStatus, UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ActionItem, ActionItemProvider, ProviderContext } from '@/lib/actionItems/types'
import { PICKUP_WINDOW_DAYS, startOfUtcDay } from '@/lib/actionItems/rules'
import { dotSheetStatesForOrders } from '@/lib/fleet/dotSheet'
import { deskBlockerSentence } from '@/lib/fleet/dotSheetPublish'

const OWNER: UserRole[] = ['ADMIN', 'MANAGER', 'FLEET_TECH', 'DISPATCHER']

/** Going out within a week is when a missing plate stops being paperwork. */
const SOON_DAYS = 7

/**
 * The order is committed and the gear has not come back. DRAFT / QUOTE_SENT
 * are deliberately out: a quote is not a rental, its "assigned" units are a
 * soft hold that may never go out, and a DOT record is not owed on it.
 */
const COMMITTED: readonly OrderStatus[] = ['APPROVED', 'BOOKED', 'LOADED_READY', 'ON_JOB']

export const dotSheetIncompleteProvider: ActionItemProvider = {
  id: 'dot-sheet-incomplete',
  kind: 'DERIVED',
  async fetch(_ctx: ProviderContext): Promise<ActionItem[]> {
    const today = startOfUtcDay()
    const until = new Date(today.getTime() + PICKUP_WINDOW_DAYS * 86_400_000)

    // Candidates first: a committed order with a booking (no booking = no
    // assignments = nothing to describe), going out INSIDE the pickup window.
    //
    // The window is the convention from rules.ts (Wes 2026-09-17: "action
    // items that are persistent on the screen even if their time of action
    // has passed"). It matters more here than for most providers: with no BIT
    // inspections on file at all, every committed order in the book would
    // otherwise raise a row on day one, which is the pile he was complaining
    // about rather than a worklist. A truck going out in three weeks is a row
    // that will arrive when it means something.
    const candidates = await prisma.order.findMany({
      where: {
        status: { in: [...COMMITTED] },
        bookingId: { not: null },
        startDate: { gte: today, lte: until },
        job: { status: { not: 'LOST' }, archivedAt: null },
      },
      select: {
        id: true, orderNumber: true, startDate: true, jobId: true, updatedAt: true,
        bookingId: true, dotSheetGeneratedAt: true,
      },
      orderBy: { startDate: 'asc' },
      take: 200,
    })

    // BATCHED — this provider runs on every /jobs landing render, so the
    // whole list costs a fixed handful of queries rather than three per order.
    const states = await dotSheetStatesForOrders(candidates)

    const items: ActionItem[] = []
    for (const o of candidates) {
      const state = states.get(o.id)
      // 'incomplete' is the only reason that is anyone's job: 'no-units'
      // means the trucks are not picked yet (a different worklist —
      // hold-unassigned already owns it), and the two published reasons are
      // the client having it.
      if (!state || state.reason !== 'incomplete') continue

      const blocker = deskBlockerSentence(state)
      if (!blocker) continue

      const daysOut =
        o.startDate ? Math.ceil((o.startDate.getTime() - today.getTime()) / 86_400_000) : null
      const soon = daysOut != null && daysOut <= SOON_DAYS

      items.push({
        id: `dot-sheet:${o.id}`,
        type: 'dot_sheet_incomplete',
        title: `DOT sheet withheld — ${o.orderNumber}`,
        subtitle: blocker,
        ownerRole: OWNER,
        priority: soon ? 'high' : 'medium',
        // The fix is on the unit, so point at Fleet rather than the order.
        href: '/fleet',
        occurredAt: o.startDate ?? o.updatedAt,
        // Pickup-tied: the panel labels the row "pickup in 4d" rather than by
        // when the order happened to be created, and sorts it soonest-first.
        dueAt: o.startDate ?? null,
        source: 'dot-sheet-incomplete',
        dismissal: { kind: 'sideRow' },
      })
    }
    return items
  },
}
