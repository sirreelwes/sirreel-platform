/**
 * "We introduced ourselves to a partner and heard nothing back" (DERIVED).
 *
 * Wes 2026-09-15, after the California Rent A Car introduction went to
 * Clifford Fields: "set up the reminder." The introduction is the one partner
 * mail that gets no automatic follow-up — a partner's reply comes to wes@ and
 * is deliberately NOT threaded into HQ (partnerMail.ts), so nothing in the
 * system knows whether they answered. This is the nudge, not an action on
 * their account: marking them a partner stays Wes's own press, because "no
 * thanks" is also a reply and it would otherwise onboard a company that
 * declined.
 *
 * ── What makes an item ─────────────────────────────────────────────
 *
 * An active vendor whose introduction went GRACE_DAYS ago, who has not been
 * marked a partner, and who shows no sign of having become one anyway — no
 * roster units, no bookings, no agreement on file. Those three are what
 * partnerStage.ts calls a legacy partner, and a company with any of them is
 * already further along than this item's advice.
 *
 * ── Why it stops appearing ─────────────────────────────────────────
 *
 * "Mark as new partner" on the Portals tab (partnerMarkedAt), which is also
 * the thing the item is asking for. Dismissal is per-user for the judgement
 * call — "he's away until the 20th".
 *
 * ADMIN only: the mark is Wes-only (welcomeSender.ts allowlist), so an item
 * a manager cannot act on would be noise in their tab.
 */

import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ActionItem, ActionItemProvider, ProviderContext } from '@/lib/actionItems/types'

const OWNER: UserRole[] = ['ADMIN']
/** Days after the introduction before the first nudge. */
export const PARTNER_INTRO_GRACE_DAYS = 4

export interface PartnerIntroRow {
  vendorId: string
  vendorName: string
  contactName: string | null
  sentAt: Date
  sentTo: string | null
}

export async function findPartnersAwaitingReply(now = new Date()): Promise<PartnerIntroRow[]> {
  const cutoff = new Date(now.getTime() - PARTNER_INTRO_GRACE_DAYS * 86_400_000)
  try {
    const vendors = await prisma.vendor.findMany({
      where: {
        isActive: true,
        welcomeSentAt: { not: null, lte: cutoff },
        partnerMarkedAt: null,
        subcontractedVehicles: { none: {} },
        subRentals: { none: {} },
        agreements: { none: { deletedAt: null } },
      },
      select: { id: true, name: true, contactName: true, welcomeSentAt: true, welcomeSentTo: true },
      orderBy: { welcomeSentAt: 'asc' },
      take: 50,
    })
    return vendors
      .filter((v) => v.welcomeSentAt)
      .map((v) => ({
        vendorId: v.id,
        vendorName: v.name,
        contactName: v.contactName,
        sentAt: v.welcomeSentAt as Date,
        sentTo: v.welcomeSentTo,
      }))
  } catch (err) {
    // The stage columns arrive by additive SQL; before that this provider
    // simply has nothing to say, like every other read of them.
    console.error('[partner-intro-unanswered] unavailable:', err instanceof Error ? err.message : err)
    return []
  }
}

/** Whole days since the introduction — what the subtitle counts. */
export function daysSince(sentAt: Date, now = new Date()): number {
  return Math.floor((now.getTime() - sentAt.getTime()) / 86_400_000)
}

/** "4 days ago" / "1 day ago" / "today" — a count nobody has to translate. */
export function agoPhrase(days: number): string {
  if (days <= 0) return 'today'
  return days === 1 ? '1 day ago' : `${days} days ago`
}

export const partnerIntroUnansweredProvider: ActionItemProvider = {
  id: 'partner-intro-unanswered',
  kind: 'DERIVED',
  async fetch(_ctx: ProviderContext): Promise<ActionItem[]> {
    const now = new Date()
    const rows = await findPartnersAwaitingReply(now)
    return rows.map((r) => {
      const who = r.contactName ? `${r.contactName} at ${r.vendorName}` : r.vendorName
      const ago = agoPhrase(daysSince(r.sentAt, now))
      return {
        id: `partner-intro-unanswered:${r.vendorId}:${r.sentAt.toISOString().slice(0, 10)}`,
        type: 'partner_intro_unanswered',
        title: `Chase the introduction — ${r.vendorName}`,
        subtitle: `You introduced SirReel to ${who} ${ago}${r.sentTo ? ` (${r.sentTo})` : ''} and they are not marked as a partner yet. Their reply comes to your inbox, not HQ, so nothing here knows either way. If they said yes, press “Mark as new partner” — that seeds their roster, mints their account link and lets them text AHA.`,
        ownerRole: OWNER,
        priority: 'medium' as const,
        href: '/crm/portals#partners',
        occurredAt: new Date(r.sentAt.getTime() + PARTNER_INTRO_GRACE_DAYS * 86_400_000),
        source: 'partner-intro-unanswered',
        dismissal: { kind: 'sideRow' as const },
      }
    })
  },
}
