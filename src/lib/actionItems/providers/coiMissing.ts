/**
 * COI-missing provider (DERIVED). Live query over live bookings that
 * are still missing a Certificate of Insurance — the same signal the
 * paperwork-summary `incompleteJobs` worklist uses (paperwork_request
 * with coi_received=false, or no paperwork_request row at all), scoped
 * to non-cancelled bookings whose rental window hasn't already ended.
 *
 * DERIVED → no per-item mutable record, so dismissal is a side-row
 * (ActionItemDismissal keyed by the item id). If the COI later arrives
 * the row simply stops matching and the item disappears on its own.
 *
 * Owner roles: sales-lifecycle → [ADMIN, MANAGER, AGENT].
 */

import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ActionItem, ActionItemProvider, ProviderContext } from '@/lib/actionItems/types'

const OWNER: UserRole[] = ['ADMIN', 'MANAGER', 'AGENT']

export const coiMissingProvider: ActionItemProvider = {
  id: 'coi-missing',
  kind: 'DERIVED',
  async fetch(_ctx: ProviderContext): Promise<ActionItem[]> {
    // Org-wide worklist — a missing COI is everyone's problem, and
    // bookings.agent_id is a CRM Person id (not the session User id),
    // so this provider does NOT narrow by OWN data-scope. Role scoping
    // (ownerRole) still applies at the registry level.
    const rows = await prisma.$queryRaw<
      Array<{ id: string; jobName: string | null; companyName: string | null; createdAt: Date }>
    >`
      SELECT b.id,
             b.job_name AS "jobName",
             c.name AS "companyName",
             b.created_at AS "createdAt"
      FROM bookings b
      LEFT JOIN companies c ON b.company_id = c.id
      LEFT JOIN paperwork_requests pr ON pr.booking_id = b.id
      WHERE b.status NOT IN ('CANCELLED', 'ARCHIVED')
        AND b.archived_at IS NULL
        AND b.end_date >= now() - interval '1 day'
        AND b.source <> 'PLANYO_BACKFILL'
        AND (pr.id IS NULL OR pr.coi_received = false)
      ORDER BY b.end_date ASC
      LIMIT 100
    `

    return rows.map((r) => ({
      id: `coi:${r.id}`,
      type: 'coi_missing',
      title: `COI missing — ${r.companyName || r.jobName || 'booking'}`,
      subtitle: `${r.jobName || 'Job'} — no certificate of insurance on file yet`,
      ownerRole: OWNER,
      priority: 'medium' as const,
      href: `/jobs/${r.id}`,
      occurredAt: r.createdAt,
      source: 'coi-missing',
      dismissal: { kind: 'sideRow' as const },
    }))
  },
}
