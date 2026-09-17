/**
 * The date and time on every walk-around photo — the ONE wording, and
 * the name a saved copy gets.
 *
 * Hugo, 2026-09-17, on the Damage ID build: "time and date at the
 * bottom of each photo submission", and "the ability to save a photo
 * from HQ to do a damage report". DamageID prints the stamp on the
 * photograph itself, which is what makes one usable in a claim: the
 * picture and its time cannot be separated. HQ had the time (the
 * condition-report PDF prints it) but the record page showed none, and
 * a photo opened from it was the bare upload with a random filename.
 *
 * So three things read this module and nothing else formats a photo's
 * time: the record page's caption under each frame, the side-by-side
 * viewer, and the stamp burned into a SAVED copy (lib/fleet/stampPhoto,
 * server-side — the stored original is never touched; a saved file is a
 * copy with the caption drawn on). Pacific, because that is the yard's
 * clock and the one the crew will be asked about.
 *
 * WHICH time: `InspectionPhoto.createdAt`, which since 2026-09-17 is the
 * moment the photo LANDED IN THE STORE from the yard (the blob's own
 * uploadedAt, carried over at filing) — seconds after the shutter for a
 * photo taken in the app, and server-of-record, so a phone with a wrong
 * clock cannot move it. Before that it was the moment the whole form was
 * filed, which is why every photo on an older walk-around carries the
 * same time to the minute. Nothing here reads camera EXIF on purpose:
 * that is the phone's word, not ours.
 *
 * Pure — no prisma, no canvas — so the client-side screens can bundle
 * it and the test runs offline.
 */

import { positionsFor, positionLabel, DAMAGE_POSITION, type WalkaroundEdge } from '@/lib/fleet/photoPositions'

export const PHOTO_TIMEZONE = 'America/Los_Angeles'

/** "Sep 16, 2026 · 2:14 PM PT" — on screen under a frame, and in the stamp. */
export function photoStampWhen(takenAt: Date): string {
  const day = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: PHOTO_TIMEZONE,
  }).format(takenAt)
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: PHOTO_TIMEZONE,
  }).format(takenAt)
  return `${day} · ${time} PT`
}

/** "Sep 16, 2:14 PM" — for a badge on a thumbnail, where the full form
 *  would not fit. The year is on the record page a tap away. */
export function photoStampShort(takenAt: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: PHOTO_TIMEZONE,
  }).format(takenAt)
}

export function edgeWord(edge: WalkaroundEdge): string {
  return edge === 'OUT' ? 'Check-out' : 'Check-in'
}

/** "5. Driver side rear" in the walk, "Damage close-up", or "Other". The
 *  number is the one on the capture screen, which is the one the crew
 *  knows (Julian's DamageID sequence). */
export function slotTitle(edge: WalkaroundEdge, position: string | null): string {
  if (!position) return positionLabel(null)
  if (position === DAMAGE_POSITION) return positionLabel(position)
  const n = positionsFor(edge).findIndex((s) => s.id === position)
  const label = positionLabel(position)
  return n >= 0 ? `${n + 1}. ${label}` : label
}

export interface PhotoStampArgs {
  unitName: string
  edge: WalkaroundEdge
  position: string | null
  takenAt: Date
}

/** The line drawn onto a saved copy:
 *  "Cube 27 · Check-out · 5. Driver side rear · Sep 16, 2026 · 2:14 PM PT" */
export function photoStampCaption(a: PhotoStampArgs): string {
  return [a.unitName, edgeWord(a.edge), slotTitle(a.edge, a.position), photoStampWhen(a.takenAt)].join(' · ')
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

function slug(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** What the saved file is called, so a folder of them sorts and reads:
 *  "Cube-27_check-out_05-driver-side-rear_2026-09-16_14-14.jpg". A
 *  stamped copy is always a JPEG; pass the original type for a raw copy. */
export function photoDownloadName(a: PhotoStampArgs & { contentType: string | null }): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: PHOTO_TIMEZONE,
  }).formatToParts(a.takenAt)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  // hour12:false can yield "24" at midnight in some engines.
  const hour = get('hour') === '24' ? '00' : get('hour')
  const when = `${get('year')}-${get('month')}-${get('day')}_${hour}-${get('minute')}`

  let slot: string
  if (!a.position) slot = 'other'
  else if (a.position === DAMAGE_POSITION) slot = 'damage-close-up'
  else {
    const n = positionsFor(a.edge).findIndex((s) => s.id === a.position)
    const label = slug(positionLabel(a.position)).toLowerCase()
    slot = n >= 0 ? `${String(n + 1).padStart(2, '0')}-${label}` : label
  }
  const ext = (a.contentType && EXT_BY_TYPE[a.contentType.toLowerCase()]) || 'jpg'
  return `${slug(a.unitName) || 'unit'}_${edgeWord(a.edge).toLowerCase()}_${slot}_${when}.${ext}`
}
