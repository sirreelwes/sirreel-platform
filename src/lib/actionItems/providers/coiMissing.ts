/**
 * COI provider (DERIVED). Live query over live bookings whose
 * Certificate of Insurance is not yet settled, scoped to non-cancelled
 * bookings whose rental hasn't already started and whose job isn't LOST.
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
 * ONE ROW PER JOB (Wes 2026-09-17). The certificate lives on the job
 * (`sr_coi_checks.job_id`), so a job with two bookings was the same ask
 * twice (Digital Paradigm in his screenshot). Rows are grouped by job in
 * `groupCoiByJob`; the item is keyed on the LEAD booking — the soonest
 * pickup — so a `coi:<bookingId>` dismissal recorded before the merge
 * still matches for the usual one-booking job. A certificate received on
 * ANY of the job's paperwork rows settles the whole job.
 *
 * PICKUP WINDOW (rules.ts): only bookings starting inside
 * PICKUP_WINDOW_DAYS. A COI for a pickup six weeks out is not this
 * week's chase and was the bulk of the 41.
 *
 * Owner roles: sales-lifecycle → [ADMIN, MANAGER, AGENT].
 */

import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ActionItem, ActionItemProvider, ProviderContext } from '@/lib/actionItems/types'
import { PICKUP_WINDOW_DAYS, groupCoiByJob } from '@/lib/actionItems/rules'

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
        startDate: Date
        coiDecision: string | null
      }>
    >`
      SELECT b.id,
             b.job_id AS "jobId",
             b.job_name AS "jobName",
             c.name AS "companyName",
             b.created_at AS "createdAt",
             b.start_date AS "startDate",
             coi.human_decision AS "coiDecision"
      FROM bookings b
      LEFT JOIN companies c ON b.company_id = c.id
      LEFT JOIN sr_jobs j ON j.id = b.job_id
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
        -- Chase a COI only BEFORE the rental starts (Wes 2026-08-31:
        -- "if the start date has passed … the items shouldn't show").
        -- Once the window opens the gear either left without one (an
        -- ops conversation, not a checklist row) or the job never ran.
        -- Start-day itself still shows — the morning of pickup is the
        -- last moment the ask is actionable.
        AND b.start_date >= CURRENT_DATE
        -- … and not further out than the pickup window (rules.ts).
        AND b.start_date <= CURRENT_DATE + ${PICKUP_WINDOW_DAYS}::int
        -- A LOST job owes us nothing — its paperwork chase dies with
        -- the quote (same Wes ruling).
        AND (j.status IS NULL OR j.status::text <> 'LOST')
        -- Planyo-imported bookings (live book since 2026-08-18) count
        -- only once HQ actually TRACKS their paperwork: a missing
        -- paperwork_request row on an import means "COI state unknown"
        -- (the COI may exist outside HQ), not "COI missing" — blanket
        -- inclusion would have dumped ~53 unknowns into the worklist
        -- at rollout. Native bookings keep no-row-counts-as-missing.
        AND (b.source <> 'PLANYO_BACKFILL' OR (pr.id IS NOT NULL AND pr.coi_received = false))
        AND (pr.id IS NULL OR pr.coi_received = false)
        -- The certificate is per JOB: received on any of the job's
        -- paperwork rows settles every booking on it.
        AND NOT EXISTS (
          SELECT 1 FROM paperwork_requests p2
          JOIN bookings b2 ON b2.id = p2.booking_id
          WHERE b.job_id IS NOT NULL AND b2.job_id = b.job_id AND p2.coi_received = true
        )
        -- A certificate signed off in the review desk settles the booking
        -- even though it never touches paperwork_requests.
        AND COALESCE(coi.human_decision::text, '') <> 'APPROVED'
        AND COALESCE(coi.coverage_verified, false) = false
      ORDER BY b.start_date ASC
      LIMIT 100
    `

    return groupCoiByJob(rows).map(({ lead: r, bookings }) => {
      const who = r.companyName || r.jobName || 'booking'
      const job = r.jobName || 'Job'
      const more = bookings.length > 1 ? ` · ${bookings.length} bookings on the job` : ''
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
              subtitle: `${job} — no certificate of insurance on file yet${more}`,
              priority: 'medium' as const,
            }
          : r.coiDecision === 'REJECTED'
            ? {
                id: `coi-rejected:${r.id}`,
                title: `COI rejected — ${who}`,
                subtitle: `${job} — we turned the certificate down; the client owes us a corrected one${more}`,
                priority: 'high' as const,
              }
            : {
                id: `coi-review:${r.id}`,
                title: `COI needs review — ${who}`,
                subtitle:
                  r.coiDecision === 'COUNTERED'
                    ? `${job} — we asked the client to fix the certificate; nothing signed off yet${more}`
                    : `${job} — certificate on file, nobody has signed off on it${more}`,
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
        dueAt: r.startDate,
        source: 'coi-missing',
        dismissal: { kind: 'sideRow' as const },
      }
    })
  },
}
