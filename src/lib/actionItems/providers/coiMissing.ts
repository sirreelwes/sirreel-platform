/**
 * COI provider (DERIVED). Live query over live bookings whose
 * Certificate of Insurance is not yet settled, scoped to non-cancelled
 * bookings whose rental window hasn't already ended.
 *
 * It reads BOTH places a COI lives, because they are different tables:
 * `paperwork_requests.coi_received` is set by the paperwork-portal
 * upload, and `sr_coi_checks` is what the review desk, the client drop
 * link and the job-page upload write. Reading only the first is why a
 * certificate Wes had personally APPROVED on the job still sat here
 * saying "no certificate of insurance on file yet" (Wes, 2026-08-25).
 *
 * The item says what is actually true, and only the exception escalates:
 *   - nothing on file            → COI missing
 *   - on file, nobody signed off → COI needs review
 *   - rejected                   → the client owes us a corrected cert
 *   - approved / verified        → no item at all
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
      Array<{
        id: string
        jobId: string | null
        jobName: string | null
        companyName: string | null
        createdAt: Date
        coiDecision: string | null
      }>
    >`
      SELECT b.id,
             b.job_id AS "jobId",
             b.job_name AS "jobName",
             c.name AS "companyName",
             b.created_at AS "createdAt",
             coi.human_decision AS "coiDecision"
      FROM bookings b
      LEFT JOIN companies c ON b.company_id = c.id
      LEFT JOIN paperwork_requests pr ON pr.booking_id = b.id
      -- The job's best certificate: an approved one if it has any,
      -- otherwise the most recent. A job can carry several — a rejected
      -- cert followed by a good one must read as settled, not rejected.
      LEFT JOIN LATERAL (
        SELECT cc.human_decision, cc.coverage_verified
        FROM sr_coi_checks cc
        WHERE cc.job_id = b.job_id
          AND cc.deleted_at IS NULL
        ORDER BY (cc.human_decision::text = 'APPROVED') DESC,
                 cc.coverage_verified DESC,
                 cc.created_at DESC
        LIMIT 1
      ) coi ON TRUE
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
        -- A certificate signed off in the review desk settles the booking
        -- even though it never touches paperwork_requests.
        AND COALESCE(coi.human_decision::text, '') <> 'APPROVED'
        AND COALESCE(coi.coverage_verified, false) = false
      ORDER BY b.end_date ASC
      LIMIT 100
    `

    return rows.map((r) => {
      const who = r.companyName || r.jobName || 'booking'
      const job = r.jobName || 'Job'
      // The id keys the per-user ActionItemDismissal side-row. `coi:` is
      // kept for the missing case so existing dismissals keep matching;
      // the other states get their own prefix, so a certificate that
      // ARRIVES after someone dismissed "COI missing" resurfaces for
      // review instead of staying silently hidden.
      const state =
        r.coiDecision === null
          ? {
              id: `coi:${r.id}`,
              title: `COI missing — ${who}`,
              subtitle: `${job} — no certificate of insurance on file yet`,
              priority: 'medium' as const,
            }
          : r.coiDecision === 'REJECTED'
            ? {
                id: `coi-rejected:${r.id}`,
                title: `COI rejected — ${who}`,
                subtitle: `${job} — we turned the certificate down; the client owes us a corrected one`,
                priority: 'high' as const,
              }
            : {
                id: `coi-review:${r.id}`,
                title: `COI needs review — ${who}`,
                subtitle:
                  r.coiDecision === 'COUNTERED'
                    ? `${job} — we asked the client to fix the certificate; nothing signed off yet`
                    : `${job} — certificate on file, nobody has signed off on it`,
                priority: 'medium' as const,
              }

      return {
        id: state.id,
        type: 'coi_missing' as const,
        title: state.title,
        subtitle: state.subtitle,
        ownerRole: OWNER,
        priority: state.priority,
        // b.id is a BOOKING id — linking it as /jobs/<id> produced a
        // dead "Job not found" page for every COI item (Wes, 2026-08-25).
        // The job is reached through Booking.jobId. Every live booking
        // carries one (verified: 0 with a null jobId), but a legacy row
        // without one falls back to the jobs list rather than a dead link.
        href: r.jobId ? `/jobs/${r.jobId}` : '/jobs',
        occurredAt: r.createdAt,
        source: 'coi-missing',
        dismissal: { kind: 'sideRow' as const },
      }
    })
  },
}
