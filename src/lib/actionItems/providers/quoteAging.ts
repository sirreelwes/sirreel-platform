/**
 * Quote-aging / ghosted provider (DERIVED). Open quotes (Order
 * quoteStatus=SENT, job not won/lost) whose quoteSentAt is older than
 * STALE_DEAL_BUSINESS_DAYS with no client movement — the "went quiet"
 * signal, aligned with the sales-hygiene staleDeals bucket.
 *
 * Order.agentId IS the session User id, so this provider honors OWN
 * data-scope: an AGENT on OWN sees only their own aging quotes; TEAM
 * (privileged) sees all.
 *
 * DERIVED → dismissal via the ActionItemDismissal side-row.
 * Owner roles: sales-lifecycle → [ADMIN, MANAGER, AGENT].
 */

import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { STALE_DEAL_BUSINESS_DAYS } from '@/lib/exec/thresholds'
import type { ActionItem, ActionItemProvider, ProviderContext } from '@/lib/actionItems/types'

const OWNER: UserRole[] = ['ADMIN', 'MANAGER', 'AGENT']

/** Walk back N business days (skip Sat/Sun) — matches sales-hygiene. */
function subtractBusinessDays(from: Date, days: number): Date {
  const d = new Date(from)
  let remaining = days
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() - 1)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) remaining--
  }
  return d
}

export const quoteAgingProvider: ActionItemProvider = {
  id: 'quote-aging',
  kind: 'DERIVED',
  async fetch(ctx: ProviderContext): Promise<ActionItem[]> {
    // OWN scope with no user → match nothing (safe default).
    if (ctx.scope === 'OWN' && !ctx.userId) return []
    const cutoff = subtractBusinessDays(new Date(), STALE_DEAL_BUSINESS_DAYS)

    const orders = await prisma.order.findMany({
      where: {
        quoteStatus: 'SENT',
        quoteSentAt: { not: null, lte: cutoff },
        job: { status: { notIn: ['WRAPPED', 'LOST'] } },
        ...(ctx.scope === 'OWN' ? { agentId: ctx.userId! } : {}),
      },
      select: {
        id: true,
        orderNumber: true,
        quoteSentAt: true,
        company: { select: { name: true } },
        job: { select: { name: true } },
      },
      orderBy: { quoteSentAt: 'asc' },
      take: 100,
    })

    return orders.map((o) => {
      const days = o.quoteSentAt
        ? Math.floor((Date.now() - o.quoteSentAt.getTime()) / 86_400_000)
        : 0
      return {
        id: `quote:${o.id}`,
        type: 'quote_aging',
        title: `Quote gone quiet — ${o.company?.name || o.job?.name || o.orderNumber}`,
        subtitle: `Quote ${o.orderNumber} sent ${days}d ago, no reply — follow up`,
        ownerRole: OWNER,
        priority: 'medium' as const,
        href: `/orders/${o.id}`,
        occurredAt: o.quoteSentAt ?? new Date(),
        source: 'quote-aging',
        dismissal: { kind: 'sideRow' as const },
      }
    })
  },
}
