/**
 * "The yard changed your order" (DERIVED).
 *
 * Hugo, 2026-09-03: "there are last minute exchanges and modifications
 * that will need to be done to the order based on the check out report.
 * This should be done and modify the order and flag back to the sales
 * agent."
 *
 * The report writes the change through to the order on submit — the
 * client is billed for what actually went, not for what was planned —
 * and this is the second half of that sentence. Without it a supervisor
 * would be silently editing an agent's order, which is a worse version
 * of the problem it solves: the client gets a corrected invoice and the
 * agent finds out from the client.
 *
 * ESCALATE-ONLY-THE-EXCEPTION (registry ruling B): a report that matched
 * the order produces NOTHING. Only a report that had to change something
 * — or a check-in that came up short — becomes an item, and only until
 * the agent acknowledges it.
 *
 * It clears when someone acknowledges the report (PATCH on the report
 * route), which is the work being done, rather than on a timer.
 */

import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ActionItem, ActionItemProvider, ProviderContext } from '@/lib/actionItems/types'

/**
 * The agent owns it; admin and managers see it because they are the ones
 * covering when an agent is on a set. BILLING is included deliberately —
 * a changed order is a changed invoice, and Ana finding out at
 * reconciliation time is exactly the late discovery this prevents.
 */
const OWNER: UserRole[] = ['ADMIN', 'MANAGER', 'AGENT', 'BILLING']

/** Older than this and the invoice has almost certainly gone out; the
 *  item stops being a nudge and starts being clutter. */
const LOOKBACK_DAYS = 30

export const checkReportChangesProvider: ActionItemProvider = {
  id: 'check-report-changes',
  kind: 'DERIVED',
  async fetch(ctx: ProviderContext): Promise<ActionItem[]> {
    if (ctx.scope === 'OWN' && !ctx.userId) return []
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000)

    const reports = await prisma.orderCheckReport.findMany({
      where: {
        changedOrder: true,
        agentAckedAt: null,
        submittedAt: { gte: since },
        order: {
          archivedAt: null,
          // A rep with OWN scope sees only their own orders — same rule
          // every other sales-side provider follows.
          ...(ctx.scope === 'OWN' && ctx.userId ? { agentId: ctx.userId } : {}),
        },
      },
      select: {
        id: true,
        edge: true,
        submittedAt: true,
        preppedBy: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            company: { select: { name: true } },
            job: { select: { name: true } },
          },
        },
        lines: {
          where: { change: { not: 'NONE' } },
          select: { description: true, expectedQty: true, actualQty: true, change: true, substituteFor: true },
        },
      },
      orderBy: { submittedAt: 'desc' },
      take: 100,
    })

    return reports.map((r) => {
      const who = r.order.company?.name || r.order.job?.name || r.order.orderNumber
      const what = r.lines.slice(0, 3).map((l) => {
        switch (l.change) {
          case 'SUBSTITUTE': return `${l.substituteFor} → ${l.description}`
          case 'ADDED':      return `added ${l.description} ×${l.actualQty}`
          case 'REMOVED':    return `did not send ${l.description}`
          default:           return `${l.description} ${l.expectedQty}→${l.actualQty}`
        }
      })
      const more = r.lines.length > 3 ? ` +${r.lines.length - 3} more` : ''
      const edgeWord = r.edge === 'OUT' ? 'went out' : 'came back'

      return {
        id: `check-report:${r.id}`,
        type: 'check_report_change',
        title: `Order changed at the dock — ${who}`,
        subtitle:
          `${r.order.orderNumber} ${edgeWord} different from the order` +
          (r.preppedBy ? ` (prepped by ${r.preppedBy})` : '') +
          `: ${what.join(', ')}${more}`,
        ownerRole: OWNER,
        // The billed value moved without the agent touching it. That is
        // as urgent as sales items get.
        priority: 'high' as const,
        href: `/orders/${r.order.id}`,
        occurredAt: r.submittedAt,
        source: 'check-report-changes',
        dismissal: { kind: 'sideRow' as const },
      }
    })
  },
}
