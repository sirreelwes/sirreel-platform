/**
 * Untouched-inquiry provider (DERIVED) — the in-app twin of the
 * hourly safety-net email (api/cron/stale-inquiries), widened to
 * GMAIL-sourced inquiries too (the cron email stays web-form-only).
 *
 * Before this existed, an unanswered public form submission escalated
 * by EMAIL only: the cron created an Alert row and mailed hq@, while
 * the /jobs landing's Action Items said "all caught up" and the queue
 * card looked like any other lead (Wes 2026-08-28). The provider reads
 * the SAME condition the cron sweeps — WEB_FORM, still NEW, no staff
 * reply, past the SLA — straight off the Inquiry rows, so it appears
 * without waiting for the cron and AUTO-CLEARS the moment anyone
 * responds, converts, or dismisses the inquiry (which the cron's Alert
 * rows never do; that's why this doesn't read them).
 *
 * Ruling B (escalate only the exception): every one of these is by
 * definition an exception — the system already told the client "an
 * agent will follow up shortly" and no agent has. HIGH, sales-owned.
 *
 * Deliberately UNSCOPED (no inquiryScopeWhere): the queue hides
 * unassigned inquiries from OWN-scope users, but an SLA breach is the
 * whole team's problem — hiding it from the people who could answer
 * it is how it got to 12h in the first place.
 */

import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ActionItem, ActionItemProvider } from '@/lib/actionItems/types'
import { INQUIRY_RESPONSE_SLA_HOURS, inquiryWaitHours } from '@/lib/sales/inquirySla'

const OWNER: UserRole[] = ['AGENT', 'ADMIN', 'MANAGER']

/** Same env override the safety-net cron honors. */
const SLA_HOURS = Number(process.env.INQUIRY_SAFETY_NET_HOURS || INQUIRY_RESPONSE_SLA_HOURS)

export const inquiryUntouchedProvider: ActionItemProvider = {
  id: 'inquiry-untouched',
  kind: 'DERIVED',
  async fetch(): Promise<ActionItem[]> {
    const cutoff = new Date(Date.now() - SLA_HOURS * 3_600_000)
    // GMAIL included since 2026-08-28 (Wes) — reply detection stamps
    // respondedAt from every tracked channel, so null is a real miss.
    const rows = await prisma.inquiry.findMany({
      where: {
        source: { in: ['WEB_FORM', 'GMAIL'] },
        status: 'NEW',
        respondedAt: null,
        createdAt: { lt: cutoff },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: {
        id: true,
        title: true,
        source: true,
        createdAt: true,
        assignedTo: { select: { name: true, email: true } },
      },
    })

    return rows.map((r) => {
      const hours = inquiryWaitHours(r)
      const wait = hours >= 48 ? `${Math.floor(hours / 24)}d` : `${hours}h`
      const who = r.assignedTo?.name || r.assignedTo?.email
      const kind = r.source === 'WEB_FORM' ? 'Web inquiry' : 'Email inquiry'
      // The "agent will follow up shortly" promise is web-form copy;
      // email senders got no such auto-reply.
      const tail =
        r.source === 'WEB_FORM'
          ? ' The client was told an agent would follow up shortly.'
          : ''
      return {
        id: `inquiry-untouched:${r.id}`,
        type: 'inquiry_untouched',
        title: `${kind} waiting ${wait} with no response — ${r.title}`,
        subtitle: who
          ? `Assigned to ${who}, still unanswered.${tail}`
          : `Unassigned and unanswered.${tail}`,
        ownerRole: OWNER,
        priority: 'high' as const,
        href: `/inquiries/${r.id}`,
        occurredAt: r.createdAt,
        source: 'inquiry-untouched',
        dismissal: { kind: 'sideRow' as const },
      }
    })
  },
}
