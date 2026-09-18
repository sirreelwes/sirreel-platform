/**
 * Client asked to move their dates (DERIVED).
 *
 * Wes 2026-09-18, on the L'anza job: "client said they wanted to change the
 * pickup date but couldn't figure out how to do that." The portal takes the
 * ask now, and a note goes to the rep on the job's thread — but a client
 * whose shoot has moved cannot be left to an inbox. This is the in-app
 * twin, and it is the one that does not get buried.
 *
 * The answer is "Change dates…" on the order, which applies the move AND
 * closes the request (/dates/apply → resolveDateChangeRequests), so acting
 * on the item is what clears it. "Close this" on the order page clears it
 * too, for the change that is not happening. On top of both, the provider
 * drops any row whose dates the order already carries — a request can never
 * outlive the thing it asked for, however the dates came to move.
 *
 * HIGH when the pickup they are trying to move is inside a week: past that
 * point the trucks are committed, the pull is being built, and an
 * unanswered date change turns into a truck at the wrong address. MEDIUM
 * otherwise — it is a direct question from a client either way.
 */

import type { UserRole } from '@prisma/client'
import type { ActionItem, ActionItemProvider } from '@/lib/actionItems/types'
import { listOpenDateChangeRequests } from '@/lib/portal/dateChangeRequest'
import { describeAsk } from '@/lib/portal/dateChangeRules'

const OWNER: UserRole[] = ['AGENT', 'ADMIN', 'MANAGER']

/** Days from now to a pickup, floored. Negative when it has passed. */
function daysUntil(d: Date, now: Date): number {
  return Math.floor((d.getTime() - now.getTime()) / 86_400_000)
}

function daysAgo(from: Date, now: Date): number {
  return Math.floor((now.getTime() - from.getTime()) / 86_400_000)
}

export const dateChangeRequestedProvider: ActionItemProvider = {
  id: 'date-change-requested',
  kind: 'DERIVED',
  async fetch(): Promise<ActionItem[]> {
    const now = new Date()
    const rows = await listOpenDateChangeRequests()

    return rows.map((r) => {
      const who = r.requestedByName || r.requestedByEmail || 'A contact on the job'
      const change = describeAsk({
        currentStart: r.currentStart,
        currentEnd: r.currentEnd,
        requestedStart: r.requestedStart,
        requestedEnd: r.requestedEnd,
      })
      const age = daysAgo(r.createdAt, now)
      const waited = age >= 1 ? ` Asked ${age} day${age === 1 ? '' : 's'} ago.` : ''
      const soon = r.pickupAt !== null ? daysUntil(r.pickupAt, now) : null
      const urgent = soon !== null && soon <= 7
      const imminent =
        soon === null
          ? ''
          : soon < 0
            ? ' Pickup has already passed.'
            : soon === 0
              ? ' Pickup is today.'
              : soon <= 7
                ? ` Pickup is in ${soon} day${soon === 1 ? '' : 's'}.`
                : ''
      const drift = r.drifted ? ' The order has moved since they asked — check what they were looking at.' : ''
      const words = r.note ? ` They said: “${r.note.slice(0, 140)}${r.note.length > 140 ? '…' : ''}”` : ''
      const label = r.jobName || r.jobCode || r.orderNumber

      return {
        id: `date-change-requested:${r.id}`,
        type: 'date_change_requested',
        title: `Date change asked for — ${label}`,
        subtitle:
          `${who} asked from their portal: ${change}.${waited}${imminent}${drift}${words} ` +
          'Nothing has moved — open the order and use "Change dates…" to see the cascade. Applying it closes this.',
        ownerRole: OWNER,
        priority: urgent ? ('high' as const) : ('medium' as const),
        href: `/orders/${r.orderId}#date-change-request`,
        occurredAt: r.createdAt,
        source: 'date-change-requested',
        dismissal: { kind: 'sideRow' as const },
      }
    })
  },
}
