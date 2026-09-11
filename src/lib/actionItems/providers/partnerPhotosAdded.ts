/**
 * "A partner put new photos on a unit and nobody at HQ has looked" (DERIVED).
 *
 * Wes 2026-09-11: partner photos go LIVE at once — no approval gate — and HQ
 * is notified. The email is the notice; this item is what stays until someone
 * actually glances: it clears when every partner-added photo on the unit is
 * either marked "Looks good" (reviewedAt) or removed. One item per unit, not
 * per photo, because a partner adds six at a time.
 *
 * Fails soft until scripts/add-partner-photo-columns.ts has run (the column
 * the query filters on does not exist yet) — no item, nothing else affected.
 */

import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ActionItem, ActionItemProvider, ProviderContext } from '@/lib/actionItems/types'
import { groupNewPartnerPhotos, type NewPartnerPhotoGroup } from '@/lib/sub-rentals/partnerPhotos'

const OWNER: UserRole[] = ['ADMIN', 'MANAGER', 'AGENT']

export async function findNewPartnerPhotos(): Promise<NewPartnerPhotoGroup[]> {
  try {
    const rows = await prisma.subcontractedVehiclePhoto.findMany({
      where: { uploadedByPartnerAt: { not: null }, reviewedAt: null, vehicle: { isActive: true } },
      select: { id: true, uploadedByPartnerAt: true, vehicle: { select: { id: true, name: true, vendor: { select: { id: true, name: true } } } } },
      orderBy: { uploadedByPartnerAt: 'desc' },
      take: 500,
    })
    return groupNewPartnerPhotos(rows.map((r) => ({ ...r, uploadedByPartnerAt: r.uploadedByPartnerAt as Date })))
  } catch {
    return []
  }
}

export const partnerPhotosAddedProvider: ActionItemProvider = {
  id: 'partner-photos-added',
  kind: 'DERIVED',
  async fetch(_ctx: ProviderContext): Promise<ActionItem[]> {
    const groups = await findNewPartnerPhotos()
    return groups.map((g) => ({
      // The newest upload is in the id, so a dismissed item comes back when
      // the partner adds more.
      id: `partner-photos-added:${g.unitId}:${g.latestAt.toISOString()}`,
      type: 'partner_photos_added',
      title: `${g.vendorName} added ${g.count} photo${g.count === 1 ? '' : 's'} — ${g.unitName}`,
      subtitle: `Live already wherever ${g.unitName} is listed. Open the unit, look them over, press “Looks good” — or remove any that should not be in front of a production.`,
      ownerRole: OWNER,
      priority: 'low' as const,
      href: `/sub-rentals/vehicles/${g.unitId}`,
      occurredAt: g.latestAt,
      source: 'partner-photos-added',
      dismissal: { kind: 'sideRow' as const },
    }))
  },
}
