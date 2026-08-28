/**
 * The UNLISTED client-facing page for a subcontracted vehicle.
 *
 * "Unlisted" here means exactly what it says: the page renders for anyone
 * holding the link, is linked from nowhere on the public site, carries
 * noindex, and is absent from sitemap.ts (an explicit allow-list). The
 * 32-byte token IS the credential — clearing it revokes the page, and there
 * is no readable slug because a guessable URL is a listed URL.
 *
 * ── The money rule ────────────────────────────────────────────────────────
 * SubcontractedVehicle carries the VENDOR'S list price and OUR negotiated
 * discount. A client seeing `discountPercent` learns our margin; a client
 * seeing the derived net cost learns what we pay King Kong. Neither may ever
 * reach this surface (Wes, 2026-08-28: rates are not on that page).
 *
 * So the select below is an explicit field allow-list, never `include` and
 * never a spread of the row. Adding a rate field to the model cannot leak
 * here by default — someone has to come to this file and name it. The
 * returned type has no money on it at all, so a page that tried to render a
 * rate would not compile.
 */
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'

/** The URL is the credential — 32 bytes puts guessing out of reach. */
const TOKEN_BYTES = 32

export interface PublicUnitPhoto {
  id: string
  caption: string | null
}

export interface PublicUnit {
  id: string
  name: string
  vehicleType: string | null
  /** From publicDescription — never the staff-facing `description`. */
  description: string | null
  /** One spec per line on the model; already split and trimmed here. */
  specs: string[]
  photos: PublicUnitPhoto[]
}

/**
 * Load a unit by its unlisted token. Returns null for an unknown or revoked
 * token, and for an inactive vehicle — a unit pulled from the roster should
 * stop rendering for clients who still hold an old link.
 */
export async function getPublicUnitByToken(token: string): Promise<PublicUnit | null> {
  if (!token || token.length < 32) return null

  const v = await prisma.subcontractedVehicle.findFirst({
    where: { publicToken: token, isActive: true },
    // Explicit non-money allow-list. Do NOT add listDailyRate,
    // listWeeklyRate, listMonthlyRate, rateNotes or discountPercent.
    //
    // publicDescription, NOT description: the staff-facing one carries
    // operational caveats aimed at reps. See the schema comment.
    select: {
      id: true,
      name: true,
      vehicleType: true,
      publicDescription: true,
      specs: true,
      photos: {
        select: { id: true, caption: true },
        orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      },
    },
  })
  if (!v) return null

  return {
    id: v.id,
    name: v.name,
    vehicleType: v.vehicleType,
    description: v.publicDescription,
    specs: (v.specs ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    photos: v.photos,
  }
}

/**
 * Resolve a gallery photo's blob URL from the token + photo id. The token
 * gates the image exactly as it gates the page, so an unlisted unit's photos
 * are not fetchable without the link.
 */
export async function getPublicUnitPhotoUrl(token: string, photoId: string): Promise<string | null> {
  if (!token || token.length < 32) return null
  const photo = await prisma.subcontractedVehiclePhoto.findFirst({
    where: { id: photoId, vehicle: { publicToken: token, isActive: true } },
    select: { url: true },
  })
  return photo?.url ?? null
}

/** Mint (or re-mint) the unlisted link. Re-minting invalidates the old URL. */
export async function mintPublicUnitToken(vehicleId: string): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString('hex')
  await prisma.subcontractedVehicle.update({
    where: { id: vehicleId },
    data: { publicToken: token, publicTokenMintedAt: new Date() },
  })
  return token
}

/** Revoke the page. Anyone holding the old link gets a 404 immediately. */
export async function revokePublicUnitToken(vehicleId: string): Promise<void> {
  await prisma.subcontractedVehicle.update({
    where: { id: vehicleId },
    data: { publicToken: null, publicTokenMintedAt: null },
  })
}

/** Path for a minted token. Callers join it to an origin. */
export function publicUnitPath(token: string): string {
  return `/unit/${token}`
}
