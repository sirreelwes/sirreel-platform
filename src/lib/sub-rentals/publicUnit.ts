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
  /** Subcontracted: publicDescription (never the staff-facing `description`).
   *  Owned: the catalog description, which is already client-facing copy. */
  description: string | null
  /** One spec per line on the model; already split and trimmed here. */
  specs: string[]
  photos: PublicUnitPhoto[]
  /** Short strapline under the name (owned rows carry one in the catalog).
   *  Rendered like /vehicles/[slug] does — as a line of copy, never as the
   *  type kicker: `subtitle` on these rows is unreliable (DLUX's still reads
   *  "Premium production van"), so it must not masquerade as a category. */
  tagline: string | null
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
  if (!v) return ownedUnitByToken(token)

  return {
    id: v.id,
    name: v.name,
    vehicleType: v.vehicleType,
    tagline: null,
    description: v.publicDescription,
    specs: (v.specs ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    photos: v.photos,
  }
}

/**
 * The same unlisted page, for a vehicle WE OWN that isn't in the public
 * catalog. Deliberately indistinguishable from the subcontracted case on the
 * rendered page: a client should not be able to tell which units are ours and
 * which we bring in, and that only holds if both go through one surface.
 *
 * Owned rows need no publicDescription — `description` on VehicleCategory is
 * already the catalog's client-facing copy, unlike the subcontracted
 * `description`, which is staff notes.
 *
 * Photos: gallery rows if any, else a single synthetic PRIMARY_PHOTO_ID that
 * the proxy resolves to photoUrl / the linked Fleet Pricing image — several
 * unpublished categories have a catalog image but no gallery, and a page with
 * no picture is not worth sending to a client.
 */
export const PRIMARY_PHOTO_ID = 'primary'

async function ownedUnitByToken(token: string): Promise<PublicUnit | null> {
  const v = await prisma.vehicleCategory.findFirst({
    where: { publicToken: token },
    select: {
      id: true,
      name: true,
      subtitle: true,
      tagline: true,
      description: true,
      lengthFt: true,
      baseVehicle: true,
      heightClearance: true,
      interiorBoxHeight: true,
      liftGateSpec: true,
      fuelType: true,
      features: true,
      photoUrl: true,
      photos: { select: { id: true }, orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
      catalogItem: { select: { imageUrl: true } },
    },
  })
  if (!v) return null

  const specs = [
    v.baseVehicle ? `Base vehicle: ${v.baseVehicle}` : null,
    v.lengthFt ? `${v.lengthFt} ft` : null,
    v.heightClearance ? `Height clearance: ${v.heightClearance}` : null,
    v.interiorBoxHeight ? `Interior box height: ${v.interiorBoxHeight}` : null,
    v.liftGateSpec ? `Lift gate: ${v.liftGateSpec}` : null,
    v.fuelType ? `Fuel: ${v.fuelType}` : null,
    ...(v.features ?? '').split('\n').map((f) => f.trim()),
  ].filter((x): x is string => !!x && x.trim() !== '')

  const hasFallbackImage = !!(v.photoUrl || v.catalogItem?.imageUrl)
  const photos: PublicUnitPhoto[] = v.photos.length
    ? v.photos.map((p) => ({ id: p.id, caption: null }))
    : hasFallbackImage
      ? [{ id: PRIMARY_PHOTO_ID, caption: null }]
      : []

  return {
    id: v.id,
    name: v.name,
    // No kicker for owned rows — see the tagline note on PublicUnit.
    vehicleType: null,
    tagline: v.tagline ?? null,
    description: v.description,
    specs,
    photos,
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
  if (photo) return photo.url

  // Owned vehicle: a real gallery row, or the synthetic primary that resolves
  // to the row's own image / the linked Fleet Pricing image.
  if (photoId === PRIMARY_PHOTO_ID) {
    const v = await prisma.vehicleCategory.findFirst({
      where: { publicToken: token },
      select: { photoUrl: true, catalogItem: { select: { imageUrl: true } } },
    })
    return v?.photoUrl ?? v?.catalogItem?.imageUrl ?? null
  }
  const owned = await prisma.vehicleCategoryPhoto.findFirst({
    where: { id: photoId, vehicleCategory: { publicToken: token } },
    select: { url: true },
  })
  return owned?.url ?? null
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
