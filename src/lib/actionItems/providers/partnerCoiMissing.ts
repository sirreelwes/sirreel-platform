/**
 * "A partner has signed but we hold no certificate of insurance" (DERIVED).
 *
 * Wes 2026-09-06, on King Kong: "Let's drop the COI demand from David for
 * now because I don't want it to hold up this week's rental, but let's
 * follow up with it in the future." So the welcome email no longer asks
 * for the certificate; this item is the follow-up.
 *
 * ── What makes an item ─────────────────────────────────────────────
 *
 * An active vendor whose live Partner Vehicle Agreement is SIGNED at least
 * GRACE_DAYS ago (clause 4 obliges them to provide a COI) and who has no
 * `coiReceivedAt` — or whose certificate has EXPIRED. A partner who has not
 * signed yet is not chased: the agreement comes first, and the signing
 * itself is tracked on the Portals tab.
 *
 * ── Why it stops appearing ─────────────────────────────────────────
 *
 * HQ stamps receipt on the Portals panel (Vendor.coiReceivedAt, with an
 * expiry). Expiry re-raises it as a renewal. Dismissal is per-user via
 * the side-row for the judgement call ("their broker is sending it Monday").
 */

import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ActionItem, ActionItemProvider, ProviderContext } from '@/lib/actionItems/types'

const OWNER: UserRole[] = ['ADMIN', 'MANAGER']
/** Days after signature before the first ask. */
export const PARTNER_COI_GRACE_DAYS = 7

export interface PartnerCoiRow {
  vendorId: string
  vendorName: string
  contactName: string | null
  signedAt: Date
  expiredAt: Date | null
}

export async function findPartnersMissingCoi(now = new Date()): Promise<PartnerCoiRow[]> {
  const cutoff = new Date(now.getTime() - PARTNER_COI_GRACE_DAYS * 86_400_000)
  const vendors = await prisma.vendor.findMany({
    where: {
      isActive: true,
      agreements: { some: { deletedAt: null, signedAt: { not: null, lte: cutoff } } },
      OR: [{ coiReceivedAt: null }, { coiExpiresAt: { lt: now } }],
    },
    select: {
      id: true, name: true, contactName: true, coiReceivedAt: true, coiExpiresAt: true,
      agreements: { where: { deletedAt: null, signedAt: { not: null } }, orderBy: { signedAt: 'desc' }, take: 1, select: { signedAt: true } },
    },
  })
  return vendors
    .filter((v) => v.agreements[0]?.signedAt)
    .map((v) => ({
      vendorId: v.id,
      vendorName: v.name,
      contactName: v.contactName,
      signedAt: v.agreements[0].signedAt as Date,
      expiredAt: v.coiReceivedAt && v.coiExpiresAt && v.coiExpiresAt < now ? v.coiExpiresAt : null,
    }))
}

export const partnerCoiMissingProvider: ActionItemProvider = {
  id: 'partner-coi-missing',
  kind: 'DERIVED',
  async fetch(_ctx: ProviderContext): Promise<ActionItem[]> {
    const rows = await findPartnersMissingCoi()
    return rows.map((r) => {
      const who = r.contactName ? `${r.contactName} at ${r.vendorName}` : r.vendorName
      return {
        id: `partner-coi-missing:${r.vendorId}:${r.expiredAt ? r.expiredAt.toISOString().slice(0, 10) : 'first'}`,
        type: 'partner_coi_missing',
        title: r.expiredAt ? `Partner COI expired — ${r.vendorName}` : `Ask for a COI — ${r.vendorName}`,
        subtitle: r.expiredAt
          ? `${r.vendorName}’s certificate expired ${r.expiredAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. Ask ${who} for the renewal, naming SirReel Production Vehicles, Inc. as additional insured, then mark it received on the Portals tab.`
          : `${who} signed the Partner Vehicle Agreement ${r.signedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}; clause 4 asks for their certificate of insurance and we hold none. Ask for it (SirReel Production Vehicles, Inc. as additional insured), then mark it received on the Portals tab.`,
        ownerRole: OWNER,
        priority: 'medium' as const,
        href: '/crm/portals#partners',
        occurredAt: r.expiredAt ?? new Date(r.signedAt.getTime() + PARTNER_COI_GRACE_DAYS * 86_400_000),
        source: 'partner-coi-missing',
        dismissal: { kind: 'sideRow' as const },
      }
    })
  },
}
