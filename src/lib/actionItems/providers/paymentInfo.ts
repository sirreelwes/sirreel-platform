/**
 * Payment-info provider (EVENT) — RULING B split by path.
 *
 * Reads the existing `payment_info_request` Alert rows (present on both
 * paths, each with a distinct title, per-user dismissed_by[] dismissal)
 * and splits on that title — never re-emits:
 *
 *   KNOWN / auto-sent  ("Payment info sent to …") → LOW-severity FYI,
 *     ownerRole [AGENT, ADMIN, MANAGER]. The system already handled it
 *     (details emailed) — this is a sales heads-up, NOT billing work.
 *
 *   UNKNOWN / no-match + internal-exception
 *     ("Payment info requested by …") → HIGH-severity BILLING item,
 *     ownerRole [BILLING, ADMIN, MANAGER]. An exception the system
 *     could not auto-clear; must not rot (the alerts carry no expiry).
 *
 * No new table; dismissal routes back to the Alert either way.
 */

import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ActionItem, ActionItemProvider, ProviderContext } from '@/lib/actionItems/types'

// Sales FYI — the auto-sent path is not billing's job.
const FYI_OWNER: UserRole[] = ['AGENT', 'ADMIN', 'MANAGER']
// Billing exception — scoped to billing + admin, NOT to every agent.
const BILLING_OWNER: UserRole[] = ['BILLING', 'ADMIN', 'MANAGER']

// The known/auto-sent alert title is emitted as
// `Payment info sent to ${client} — confirm received / follow up`.
const SENT_TITLE_RE = /^Payment info sent to (.+?) — confirm received/

export const paymentInfoProvider: ActionItemProvider = {
  id: 'payment-info',
  kind: 'EVENT',
  async fetch(ctx: ProviderContext): Promise<ActionItem[]> {
    const rows = await prisma.$queryRaw<
      Array<{ id: string; title: string; body: string; link: string | null; created_at: Date }>
    >`
      SELECT id, title, body, link, created_at
      FROM alerts
      WHERE type = 'payment_info_request'
        AND (expires_at IS NULL OR expires_at > now())
        AND NOT (dismissed_by @> ARRAY[${ctx.userEmail}]::text[])
      ORDER BY created_at DESC
      LIMIT 100
    `

    return rows.map((r) => {
      const sentMatch = r.title.match(SENT_TITLE_RE)
      if (sentMatch) {
        // KNOWN / auto-sent → low-priority sales FYI.
        const client = sentMatch[1]
        return {
          id: `payment:${r.id}`,
          type: 'payment_info_sent',
          title: `${client} requested billing info — details were sent to their email.`,
          subtitle: r.body || 'Auto-sent — no action needed unless they follow up.',
          ownerRole: FYI_OWNER,
          priority: 'low' as const,
          href: r.link,
          occurredAt: r.created_at,
          source: 'payment-info',
          dismissal: { kind: 'alert' as const, alertId: r.id },
        }
      }
      // UNKNOWN / exception → high-priority billing task.
      return {
        id: `payment:${r.id}`,
        type: 'payment_info_needs_followup',
        title: r.title,
        subtitle: r.body || 'No match — verify the requester and send details manually.',
        ownerRole: BILLING_OWNER,
        priority: 'high' as const,
        href: r.link,
        occurredAt: r.created_at,
        source: 'payment-info',
        dismissal: { kind: 'alert' as const, alertId: r.id },
      }
    })
  },
}
