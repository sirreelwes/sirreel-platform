/**
 * Client asked for an annual agreement (DERIVED).
 *
 * A client can now raise the ask from their job's paperwork page or from
 * their account portal (src/lib/portal/annualRequest.ts). Nothing else
 * fires on it: no email goes out, no agreement row is created, and the
 * job's own paperwork is unchanged — so without this item the ask would
 * sit in a table nobody reads.
 *
 * The answer is one click on the CRM company page ("Offer annual
 * agreement"), which files the pending master AND closes the request, so
 * acting on the item is what clears it. Not dismissible-by-fixing-nothing:
 * the per-user sideRow dismissal still exists for an agent who has decided
 * this account isn't getting one, and the provider drops the row on its own
 * once a master is pending or covering.
 *
 * MEDIUM, not high: it is money on the table and a real client asking a
 * direct question, but nothing is blocked on it — the show in front of them
 * papers normally either way.
 */

import type { UserRole } from '@prisma/client'
import type { ActionItem, ActionItemProvider } from '@/lib/actionItems/types'
import { listOpenAnnualRequests } from '@/lib/portal/annualRequest'

const OWNER: UserRole[] = ['AGENT', 'ADMIN', 'MANAGER']

function daysAgo(from: Date, now: Date): number {
  return Math.floor((now.getTime() - from.getTime()) / 86_400_000)
}

export const annualRequestedProvider: ActionItemProvider = {
  id: 'annual-requested',
  kind: 'DERIVED',
  async fetch(): Promise<ActionItem[]> {
    const now = new Date()
    const rows = await listOpenAnnualRequests()

    return rows.map((r) => {
      const who = r.requestedByName || r.requestedByEmail || 'Someone on the account'
      const where =
        r.source === 'ACCOUNT_PORTAL'
          ? 'from their account portal'
          : r.jobCode
            ? `from the paperwork page on ${r.jobCode}`
            : 'from a job paperwork page'
      const age = daysAgo(r.createdAt, now)
      const waited = age >= 1 ? ` Asked ${age} day${age === 1 ? '' : 's'} ago.` : ''
      const tail = r.agentName ? ` ${r.agentName} owns the account.` : ' Nobody assigned.'
      return {
        id: `annual-requested:${r.id}`,
        type: 'annual_requested',
        title: `Annual agreement asked for — ${r.companyName}`,
        subtitle: `${who} asked ${where}.${waited}${tail} Offer the annual on the company page — an executive there signs it once and every show after is papered by a one-page addendum.`,
        ownerRole: OWNER,
        priority: 'medium' as const,
        href: `/crm/${r.companyId}`,
        occurredAt: r.createdAt,
        source: 'annual-requested',
        dismissal: { kind: 'sideRow' as const },
      }
    })
  },
}
