/**
 * Email change-signal provider (EVENT). An OPEN JobEmailSignal — a client
 * email that reads like a cancellation / hold / moved dates / extension /
 * early return on a live job, written at ingest by
 * src/lib/email/jobChangeSignals.ts and NEVER applied by the system.
 *
 * The item is the suggestion; the job page card is where a person
 * confirms or dismisses it. High priority because the alternative is a
 * truck going out on a job the client wrote in to cancel. Dismissing the
 * ITEM here only hides it for that user (sideRow, like every provider);
 * the signal itself stays OPEN until someone resolves it on the job.
 *
 * Owner roles: sales-lifecycle → [ADMIN, MANAGER, AGENT]. OWN scope shows
 * an agent the signals on their own jobs (Order.agentId).
 *
 * Fail-soft: the table is a 2026-09-11 addition; until `prisma db push`
 * the query throws and the provider returns nothing.
 */

import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { SIGNAL_KIND_LABEL } from '@/lib/email/jobChangeSignals'
import type { ActionItem, ActionItemProvider, ProviderContext } from '@/lib/actionItems/types'

const OWNER: UserRole[] = ['ADMIN', 'MANAGER', 'AGENT']

export const emailChangeSignalProvider: ActionItemProvider = {
  id: 'email-change-signal',
  kind: 'EVENT',
  async fetch(ctx: ProviderContext): Promise<ActionItem[]> {
    if (ctx.scope === 'OWN' && !ctx.userId) return []

    const rows = await prisma.jobEmailSignal
      .findMany({
        where: {
          status: 'OPEN',
          ...(ctx.scope === 'OWN' ? { job: { orders: { some: { agentId: ctx.userId! } } } } : {}),
        },
        select: {
          id: true,
          kind: true,
          evidence: true,
          createdAt: true,
          job: { select: { id: true, name: true, company: { select: { name: true } } } },
          message: { select: { fromAddress: true, sentAt: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
      .catch(() => [])

    return rows.map((r) => ({
      id: `email-signal:${r.id}`,
      type: 'email_change_signal',
      title: `Client ${SIGNAL_KIND_LABEL[r.kind]} — ${r.job.name}`,
      subtitle: `${r.job.company?.name ? `${r.job.company.name} · ` : ''}${r.message.fromAddress} ${r.evidence[0] ?? ''} — confirm or dismiss on the job`,
      ownerRole: OWNER,
      priority: 'high' as const,
      href: `/jobs/${r.job.id}#email-signals`,
      occurredAt: r.message.sentAt ?? r.createdAt,
      source: 'email-change-signal',
      dismissal: { kind: 'sideRow' as const },
    }))
  },
}
