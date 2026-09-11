/**
 * "A partner's booking was cancelled and the line never went on the pick list"
 * (DERIVED).
 *
 * Wes 2026-09-11: partner lines stay off the pick list, and "there needs to be a
 * warning wired in" for the gap that leaves — a partner cancels, SirReel fills
 * the line from its own shelf, and the warehouse is never told.
 *
 * One item per waiting line (lib/orders/partnerCancelledLines.ts). High once
 * the order is loaded or on the job, or picks up within three days. Clears when
 * someone puts it on the pick list from the order page, removes the line, or
 * books a partner again; dismissal is per-user for "it's already sorted".
 */

import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ActionItem, ActionItemProvider, ProviderContext } from '@/lib/actionItems/types'
import { findPartnerCancelledLines, partnerCancelledPriority } from '@/lib/orders/partnerCancelledLines'

const OWNER: UserRole[] = ['ADMIN', 'MANAGER', 'AGENT']

export const partnerCancelledOffPickListProvider: ActionItemProvider = {
  id: 'partner-cancelled-off-pick-list',
  kind: 'DERIVED',
  async fetch(_ctx: ProviderContext): Promise<ActionItem[]> {
    const rows = await findPartnerCancelledLines(prisma)
    return rows.map((r) => ({
      id: `partner-cancelled-off-pick-list:${r.lineId}`,
      type: 'partner_cancelled_off_pick_list',
      title: `Not on the pick list — ${r.orderNumber} · ${r.description}`,
      subtitle:
        `${r.vendorName ?? 'The partner'}’s booking${r.unitName ? ` for ${r.unitName}` : ''} was cancelled, so this line is ours to fill — ` +
        'but it never went on the warehouse pick list. Open the order and put it on the list, or remove the line if it isn’t going out.',
      ownerRole: OWNER,
      priority: partnerCancelledPriority(r.orderStatus, r.pickupDate),
      href: `/orders/${r.orderId}`,
      occurredAt: r.cancelledAt ?? new Date(),
      source: 'partner-cancelled-off-pick-list',
      dismissal: { kind: 'sideRow' as const },
    }))
  },
}
