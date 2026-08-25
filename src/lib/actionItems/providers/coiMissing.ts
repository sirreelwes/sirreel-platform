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
      Array<{ id: string; jobId: string | null; jobName: string | null; companyName: string | null; createdAt: Date }>
    >`
      SELECT b.id,
             b.job_id AS "jobId",
             b.job_name AS "jobName",
             c.name AS "companyName",
             b.created_at AS "createdAt"
      FROM bookings b
      LEFT JOIN companies c ON b.company_id = c.id
      LEFT JOIN paperwork_requests pr ON pr.booking_id = b.id
      WHERE b.status NOT IN ('CANCELLED', 'ARCHIVED')
        AND b.archived_at IS NULL
        AND b.end_date >= now() - interval '1 day'
        -- Planyo-imported bookings (live book since 2026-08-18) count
        -- only once HQ actually TRACKS their paperwork: a missing
        -- paperwork_request row on an import means "COI state unknown"
        -- (the COI may exist outside HQ), not "COI missing" — blanket
        -- inclusion would have dumped ~53 unknowns into the worklist
        -- at rollout. Native bookings keep no-row-counts-as-missing.
        AND (b.source <> 'PLANYO_BACKFILL' OR (pr.id IS NOT NULL AND pr.coi_received = false))
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
      // b.id is a BOOKING id — linking it as /jobs/<id> produced a
      // dead "Job not found" page for every COI item (Wes, 2026-08-25).
      // The job is reached through Booking.jobId. Every live booking
      // carries one (verified: 0 with a null jobId), but a legacy row
      // without one falls back to the jobs list rather than a dead link.
      // The item ID deliberately stays keyed on the BOOKING so existing
      // ActionItemDismissal side-rows keep matching.
      href: r.jobId ? `/jobs/${r.jobId}` : '/jobs',
      occurredAt: r.createdAt,
      source: 'coi-missing',
      dismissal: { kind: 'sideRow' as const },
    }))
  },
}
