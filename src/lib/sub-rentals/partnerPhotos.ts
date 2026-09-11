/**
 * Partner-uploaded photos: live at once, HQ told.
 *
 * Wes 2026-09-11, choosing between "HQ approves before public" and "live at
 * once, HQ notified": the second. Evan puts a photo on his generator and it
 * is on sirreel.com the moment the unit is listed and the agreement is
 * signed, exactly like a photo HQ added. What HQ gets is a glance: one email
 * per burst of uploads, and one Action Item per unit with new photos that
 * clears when someone presses "Looks good" (reviewedAt) or removes the photo.
 *
 * Pure helpers here so the debounce and the grouping can be tested without
 * a database; the writes live in vendorAccountActions.notePartnerPhotoAdded.
 */

/** A partner picking six photos uploads them one at a time over a few
 *  seconds; HQ wants one email for the six, not six. */
export const PARTNER_PHOTO_NOTIFY_WINDOW_MS = 10 * 60_000

/** Email HQ only when no other partner upload on this unit landed inside the
 *  window — the first photo of a burst carries the notice for all of them. */
export function shouldNotifyHq(previousPartnerUploadAt: Date | null, now: Date = new Date()): boolean {
  if (!previousPartnerUploadAt) return true
  return now.getTime() - previousPartnerUploadAt.getTime() > PARTNER_PHOTO_NOTIFY_WINDOW_MS
}

export interface NewPartnerPhotoRow {
  id: string
  uploadedByPartnerAt: Date
  vehicle: { id: string; name: string; vendor: { id: string; name: string } }
}

export interface NewPartnerPhotoGroup {
  unitId: string
  unitName: string
  vendorId: string
  vendorName: string
  photoIds: string[]
  count: number
  /** Newest upload in the group — the action item's id and timestamp. */
  latestAt: Date
}

/** One group per unit, newest first. */
export function groupNewPartnerPhotos(rows: NewPartnerPhotoRow[]): NewPartnerPhotoGroup[] {
  const by = new Map<string, NewPartnerPhotoGroup>()
  for (const r of rows) {
    const g = by.get(r.vehicle.id) ?? {
      unitId: r.vehicle.id, unitName: r.vehicle.name, vendorId: r.vehicle.vendor.id, vendorName: r.vehicle.vendor.name,
      photoIds: [], count: 0, latestAt: r.uploadedByPartnerAt,
    }
    g.photoIds.push(r.id)
    g.count += 1
    if (r.uploadedByPartnerAt > g.latestAt) g.latestAt = r.uploadedByPartnerAt
    by.set(r.vehicle.id, g)
  }
  return [...by.values()].sort((a, b) => b.latestAt.getTime() - a.latestAt.getTime())
}
