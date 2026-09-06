/**
 * Card-required provider (DERIVED). Upcoming bookings where HQ sent the
 * card link and no card ever arrived — in either store.
 *
 * Wes, 2026-09-06 (Figurov LLC asked to skip the portal and send a paper
 * authorization): "if this happens again, HQ needs to require the agent
 * to manually enter the CC prior to the job." This is the agent's half of
 * that rule. The yard's half is the check-out refusal in
 * src/lib/payments/cardGate.ts; this item exists so the agent hears about
 * it days before the yard does, not the morning the client is standing at
 * the gate.
 *
 * Scope is deliberately HQ-tracked capture only (a paperwork_requests row
 * exists): Planyo-era and annual accounts hold their authorization outside
 * HQ, and "no card in HQ" there means "never asked", not "missing". Same
 * rule as coi-missing.
 *
 * Only the exception escalates: link sent, nothing on file, rental not
 * started. A card in the portal row or on the company wallet clears it on
 * its own. HIGH inside 3 days of pickup, medium before that.
 *
 * Owner roles: sales-lifecycle → [ADMIN, MANAGER, AGENT].
 */

import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ActionItem, ActionItemProvider, ProviderContext } from '@/lib/actionItems/types'

const OWNER: UserRole[] = ['ADMIN', 'MANAGER', 'AGENT']
const URGENT_DAYS = 3

export const cardRequiredProvider: ActionItemProvider = {
  id: 'card-required',
  kind: 'DERIVED',
  async fetch(_ctx: ProviderContext): Promise<ActionItem[]> {
    const rows = await prisma.$queryRaw<
      Array<{
        bookingId: string
        jobId: string | null
        jobName: string | null
        companyName: string | null
        startDate: Date
        sentAt: Date
        sentTo: string
      }>
    >`
      SELECT b.id AS "bookingId",
             b.job_id AS "jobId",
             b.job_name AS "jobName",
             c.name AS "companyName",
             b.start_date AS "startDate",
             pr.sent_at AS "sentAt",
             pr.sent_to AS "sentTo"
      FROM bookings b
      JOIN paperwork_requests pr ON pr.booking_id = b.id
      LEFT JOIN companies c ON c.id = b.company_id
      LEFT JOIN sr_jobs j ON j.id = b.job_id
      WHERE b.status NOT IN ('CANCELLED', 'ARCHIVED')
        AND b.archived_at IS NULL
        AND b.start_date >= CURRENT_DATE
        AND (j.status IS NULL OR j.status::text <> 'LOST')
        -- No portal card on ANY of the job's paperwork rows …
        AND NOT EXISTS (
          SELECT 1 FROM paperwork_requests p2
          JOIN bookings b2 ON b2.id = p2.booking_id
          WHERE b2.job_id = b.job_id AND p2.cc_card_number_encrypted IS NOT NULL
        )
        -- … and nothing keyed onto the company wallet either.
        AND NOT EXISTS (
          SELECT 1 FROM sr_company_cards cc
          WHERE cc.company_id = b.company_id AND cc.removed_at IS NULL
        )
      ORDER BY b.start_date ASC
      LIMIT 100
    `

    // One item per JOB — a job with two bookings is one card to chase.
    const seen = new Set<string>()
    const out: ActionItem[] = []
    for (const r of rows) {
      const key = r.jobId ?? r.bookingId
      if (seen.has(key)) continue
      seen.add(key)

      const days = Math.ceil((r.startDate.getTime() - Date.now()) / 86_400_000)
      const when =
        days <= 0 ? 'today' : days === 1 ? 'tomorrow' : r.startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
      const sentDays = Math.floor((Date.now() - r.sentAt.getTime()) / 86_400_000)
      const sentAgo = sentDays <= 0 ? 'today' : `${sentDays}d ago`
      const who = r.companyName || r.jobName || 'client'

      out.push({
        id: `card-required:${key}`,
        type: 'card_required',
        title: `Card not on file — ${who}`,
        subtitle: `${r.jobName || 'Job'} goes out ${when} · link sent ${sentAgo} to ${r.sentTo}, never completed · key in a signed authorization or the yard can't release it`,
        ownerRole: OWNER,
        priority: days <= URGENT_DAYS ? 'high' : 'medium',
        href: r.jobId ? `/jobs/${r.jobId}` : '/jobs',
        occurredAt: r.sentAt,
        source: 'card-required',
        dismissal: { kind: 'sideRow' },
      })
    }
    return out
  },
}
