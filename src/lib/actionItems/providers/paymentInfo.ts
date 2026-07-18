/**
 * Payment-info provider (EVENT). Reads the existing
 * `payment_info_request` Alert rows — the record present on BOTH the
 * known/sent path and the unknown/needs-follow-up path, each already
 * carrying a distinct title, high severity, a link, and the per-user
 * dismissed_by[] dismissal. No new table; dismissal routes back to the
 * Alert.
 *
 * Owner roles: payment/billing → admin + billing. There is no BILLING
 * role in the enum — Ana (billing) is an AGENT — so this resolves to
 * [ADMIN, MANAGER, AGENT].
 */

import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ActionItem, ActionItemProvider, ProviderContext } from '@/lib/actionItems/types'

const OWNER: UserRole[] = ['ADMIN', 'MANAGER', 'AGENT']

export const paymentInfoProvider: ActionItemProvider = {
  id: 'payment-info',
  kind: 'EVENT',
  async fetch(ctx: ProviderContext): Promise<ActionItem[]> {
    // Non-dismissed, non-expired payment_info_request alerts for this user.
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
    return rows.map((r) => ({
      id: `payment:${r.id}`,
      type: 'payment_info',
      // The Alert titles already distinguish sent ("Payment info sent
      // to …") vs unmatched ("… no match, needs manual follow-up").
      title: r.title,
      subtitle: r.body || 'Payment-info request',
      ownerRole: OWNER,
      priority: 'high' as const,
      href: r.link,
      occurredAt: r.created_at,
      source: 'payment-info',
      dismissal: { kind: 'alert' as const, alertId: r.id },
    }))
  },
}
