/**
 * Where a would-be partner is: PROSPECT → INTRODUCED → PARTNER.
 *
 * Wes 2026-09-11: "no company gets onboarded until they reply and I mark it
 * as a new partner." Before this, "onboarding" was one script run that made
 * the vendor, seeded a roster and minted the account link in one go — a
 * company that had never heard from us had a page of our paperwork waiting.
 * Now:
 *
 *   prospect    a Vendor row exists (queued by scripts/onboard-battery-
 *               partners.ts, or added by hand) so the introduction can be
 *               sent. No roster, no account link. partnerProspectAt set.
 *   introduced  the introduction went (welcomeSentAt). Still nothing else.
 *   partner     they replied and Wes pressed "Mark as new partner"
 *               (partnerMarkedAt). markAsPartner() seeds the starter roster
 *               from the prospect registry, mints the account link, and the
 *               account-link email unlocks. The deal, the agreement and the
 *               listing switch follow as before.
 *
 * LEGACY partners (King Kong, PowerTrip) predate the mark and carry no
 * partnerMarkedAt; they read as PARTNER because they have roster units,
 * bookings or an agreement on file. A minted account link alone is NOT that:
 * the Portals row has a "mint link" button any staff member can press.
 *
 * FAILS SOFT. The three columns arrive by additive SQL
 * (scripts/add-partner-prospect-columns.ts), not db push, so until that has
 * run every read here returns null / empty and the callers keep their old
 * behaviour (the account link gated on the introduction alone; no prospects
 * listed). Only markAsPartner() refuses outright, naming the script.
 */

import { prisma } from '@/lib/prisma'
import { ensureVendorPortalToken, vendorAccountUrl } from '@/lib/sub-rentals/vendorAccount'
import { findPartnerProspectByName } from '@/lib/sub-rentals/partnerProspects'

export type PartnerStage = 'vendor' | 'prospect' | 'introduced' | 'partner'

export interface PartnerStageFacts {
  partnerProspectAt: Date | string | null
  welcomeSentAt: Date | string | null
  partnerMarkedAt: Date | string | null
  /** Roster units, bookings or an agreement on file — a partner from before
   *  the mark existed. */
  legacyPartner: boolean
}

/** The one rule. Pure, so the Portals row, the invite gate and the panel
 *  cannot disagree. */
export function partnerStage(f: PartnerStageFacts): PartnerStage {
  if (f.partnerMarkedAt) return 'partner'
  if (f.legacyPartner) return 'partner'
  if (f.welcomeSentAt) return 'introduced'
  if (f.partnerProspectAt) return 'prospect'
  return 'vendor'
}

export const STAGE_LABEL: Record<PartnerStage, string> = {
  vendor: 'Vendor',
  prospect: 'Prospect',
  introduced: 'Introduced',
  partner: 'Partner',
}

type StageRow = {
  id: string
  partnerProspectAt: Date | null
  welcomeSentAt: Date | null
  partnerMarkedAt: Date | null
  _count: { subcontractedVehicles: number; subRentals: number; agreements: number }
}

/** Stage per vendor id. NULL when the stage columns are not in the DB yet —
 *  callers fall back to what they did before the stage existed. */
export async function readPartnerStages(vendorIds: string[]): Promise<Map<string, PartnerStage> | null> {
  if (vendorIds.length === 0) return new Map()
  try {
    const rows: StageRow[] = await prisma.vendor.findMany({
      where: { id: { in: vendorIds } },
      select: {
        id: true, partnerProspectAt: true, welcomeSentAt: true, partnerMarkedAt: true,
        _count: { select: { subcontractedVehicles: true, subRentals: true, agreements: { where: { deletedAt: null } } } },
      },
    })
    const out = new Map<string, PartnerStage>()
    for (const r of rows) {
      out.set(r.id, partnerStage({
        partnerProspectAt: r.partnerProspectAt,
        welcomeSentAt: r.welcomeSentAt,
        partnerMarkedAt: r.partnerMarkedAt,
        legacyPartner: r._count.subcontractedVehicles > 0 || r._count.subRentals > 0 || r._count.agreements > 0,
      }))
    }
    return out
  } catch {
    return null
  }
}

export async function vendorStage(vendorId: string): Promise<PartnerStage | null> {
  const m = await readPartnerStages([vendorId])
  return m ? (m.get(vendorId) ?? 'vendor') : null
}

/** Vendors queued as prospects — so the Portals tab can list them before
 *  they have a roster or a link. Empty until the columns exist. */
export async function findProspectVendorIds(): Promise<string[]> {
  try {
    const rows = await prisma.vendor.findMany({
      where: { isActive: true, partnerProspectAt: { not: null } },
      select: { id: true },
    })
    return rows.map((r) => r.id)
  } catch {
    return []
  }
}

export const PARTNER_MARKED_ACTION = 'vendor.partner_marked'

const SEED_NOTE = (vendorName: string, contact: string | null) =>
  `Seeded when ${vendorName} was marked as a new partner, from the prospect registry (src/lib/sub-rentals/partnerProspects.ts). Confirm the exact model, capacity and rates with ${contact ?? 'the partner'} before quoting; rates are proposed by the partner from their account page.`

/**
 * Wes's mark, after they reply. Idempotent: marking twice changes nothing
 * and reports what is already there.
 *
 *   1. Refuses unless the introduction has gone — a reply presupposes it.
 *   2. Stamps partnerMarkedAt / partnerMarkedBy.
 *   3. Seeds the starter roster from the registry when the vendor has no
 *      units yet and the registry knows them by name; otherwise leaves the
 *      roster to the roster page.
 *   4. Mints the account link (silent — the email is the next button).
 *   5. Writes one AuditLog row.
 */
export async function markAsPartner(vendorId: string, by: { userId: string | null; email: string }): Promise<{
  alreadyMarked: boolean
  seededUnits: number
  rosterUnits: number
  accountUrl: string
}> {
  let v: {
    id: string; name: string; contactName: string | null; isActive: boolean
    welcomeSentAt: Date | null; partnerMarkedAt: Date | null
    _count: { subcontractedVehicles: number }
  } | null
  try {
    v = await prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true, name: true, contactName: true, isActive: true, welcomeSentAt: true, partnerMarkedAt: true, _count: { select: { subcontractedVehicles: true } } },
    })
  } catch {
    throw Object.assign(
      new Error('The partner stage columns are not in the database yet — run scripts/add-partner-prospect-columns.ts first.'),
      { status: 503 },
    )
  }
  if (!v || !v.isActive) throw Object.assign(new Error('Vendor not found'), { status: 404 })
  if (!v.welcomeSentAt) {
    throw Object.assign(new Error('Send the introduction first — a company is marked as a partner after it replies.'), { status: 409 })
  }

  const alreadyMarked = !!v.partnerMarkedAt
  if (!alreadyMarked) {
    await prisma.vendor.update({ where: { id: v.id }, data: { partnerMarkedAt: new Date(), partnerMarkedBy: by.email } })
  }

  let seededUnits = 0
  if (v._count.subcontractedVehicles === 0) {
    const prospect = findPartnerProspectByName(v.name)
    if (prospect) {
      for (const u of prospect.roster) {
        await prisma.subcontractedVehicle.create({
          data: {
            vendorId: v.id,
            name: u.name,
            vehicleType: u.vehicleType,
            description: SEED_NOTE(v.name, v.contactName),
            publicDescription: u.publicDescription,
            specs: u.specs.join('\n'),
            catalogSection: u.section,
            defaultReceiveMethod: 'DELIVERY',
            publiclyListed: false,
            offeredToSirReel: true,
          },
        })
        seededUnits++
      }
    }
  }

  const token = await ensureVendorPortalToken(v.id)
  const accountUrl = vendorAccountUrl(token)

  if (!alreadyMarked) {
    await prisma.auditLog.create({
      data: {
        userId: by.userId,
        action: PARTNER_MARKED_ACTION,
        entityType: 'Vendor',
        entityId: v.id,
        newValues: { by: by.email, seededUnits, accountUrl },
      },
    }).catch(() => {})
  }

  return { alreadyMarked, seededUnits, rosterUnits: v._count.subcontractedVehicles + seededUnits, accountUrl }
}
