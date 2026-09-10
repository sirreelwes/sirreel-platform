/**
 * Live read helpers for the public /vehicles pages. Single source of truth is
 * the VehicleCategory table (same rows the order form shows). Price is resolved
 * the SAME way as /api/public/vehicle-categories: the linked Fleet Pricing
 * (AssetCategory.dailyRate) wins, else the row's own fallback, else
 * price-on-quote. Images go through the existing public proxy.
 *
 * Client visibility: a vehicle appears on the public site ONLY when
 * published=true AND it has at least one image source (a VehicleCategoryPhoto
 * gallery row, the legacy photoUrl, or the linked Fleet Pricing image).
 * Everything else — including active rows — is hidden and 404s on its slug.
 */
import { Prisma } from '@prisma/client'
import { PARTNER_ATTRIBUTION_SELECT, partnerAttribution } from '@/lib/sub-rentals/partnerAttribution'
import { prisma } from '@/lib/prisma'
import { pickEffectiveDailyRate } from '@/lib/pricing/resolveRate'
import { PARTNER_SECTIONS, resolvePartnerSection, type PartnerCatalogSectionKey, type PartnerSectionMeta } from '@/lib/site/partnerSections'

/**
 * Shared Prisma where-clause for "client-visible on the public site".
 * Used by these helpers, /api/public/vehicle-categories and the public
 * image proxy so the gate can never drift between surfaces.
 */
export const PUBLIC_VEHICLE_VISIBLE_WHERE: Prisma.VehicleCategoryWhereInput = {
  active: true,
  published: true,
  OR: [
    { photos: { some: {} } },
    { photoUrl: { not: null } },
    { catalogItem: { imageUrl: { not: null } } },
  ],
}

export interface PublicVehicleSpec {
  baseVehicle: string | null
  model: string | null
  fuelType: string | null
  lengthFt: number | null
  heightClearance: string | null
  interiorBoxHeight: string | null
  liftGateSpec: string | null
}

export interface PublicVehiclePhoto {
  id: string
  /** Public image-proxy path for this gallery photo. */
  src: string
  isPrimary: boolean
}

export interface PublicVehicle {
  id: string
  name: string
  slug: string
  subtitle: string | null
  tagline: string | null
  description: string | null
  /** Feature bullets (one per stored line), [] when none. */
  features: string[]
  /** Resolved daily rate (number) or null = price-on-quote. */
  dailyRate: number | null
  /** Public image-proxy path, or null (→ placeholder). */
  photoUrl: string | null
  /** Gallery photos, primary first then sortOrder asc. [] → legacy photoUrl only. */
  photos: PublicVehiclePhoto[]
  specs: PublicVehicleSpec
  /** True for a partner-supplied unit. Together with `section` it decides
   *  which block the card renders in; it is NOT the section test on its own
   *  any more — an OWNED specialty vehicle sits in a section too. */
  partner: boolean
  /** "PowerTrip Rentals" when that partner has given written permission to be
   *  named (agreement cl. 10), else null — including for our own fleet. Read
   *  through partnerAttribution.ts; never derive it from `partner`. */
  suppliedBy: string | null
  /** Which catalog section this card belongs to, or null for the owned
   *  fleet grid. See partnerSections.ts. Owned rows flagged
   *  `isSpecialtyVehicle` carry LOCATION_VEHICLES — the Specialty Vehicles
   *  section — because a restroom trailer and a partner's coach are the
   *  same thing to a client, whoever's name is on the title. */
  section: PartnerCatalogSectionKey | null
}

const SELECT: Prisma.VehicleCategorySelect = {
  id: true,
  name: true,
  slug: true,
  subtitle: true,
  tagline: true,
  description: true,
  features: true,
  photoUrl: true,
  dailyRate: true,
  baseVehicle: true,
  model: true,
  fuelType: true,
  lengthFt: true,
  heightClearance: true,
  interiorBoxHeight: true,
  liftGateSpec: true,
  isSpecialtyVehicle: true,
  catalogItem: { select: { dailyRate: true, imageUrl: true } },
  photos: {
    select: { id: true, isPrimary: true },
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  },
}

type Row = {
  id: string
  name: string
  slug: string
  subtitle: string | null
  tagline: string | null
  description: string | null
  features: string | null
  photoUrl: string | null
  dailyRate: unknown
  baseVehicle: string | null
  model: string | null
  fuelType: string | null
  lengthFt: unknown
  heightClearance: string | null
  interiorBoxHeight: string | null
  liftGateSpec: string | null
  catalogItem: { dailyRate: unknown; imageUrl: string | null } | null
  photos: { id: string; isPrimary: boolean }[]
  isSpecialtyVehicle: boolean
}

/** Newline-separated features column → trimmed bullet lines. */
export function parseFeatures(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
}

function shape(r: Row): PublicVehicle {
  const effective = pickEffectiveDailyRate(r)
  const photos: PublicVehiclePhoto[] = r.photos.map((p) => ({
    id: p.id,
    src: `/api/public/catalog-image/vehicle-photo/${p.id}`,
    isPrimary: p.isPrimary,
  }))
  const hasImage = photos.length > 0 || !!(r.photoUrl || r.catalogItem?.imageUrl)
  return {
    partner: false,
    suppliedBy: null,
    // Owned, but a Specialty Vehicle (Wes 2026-09-10) — it leaves the
    // fleet grid and joins the coaches and trailers under one heading.
    section: r.isSpecialtyVehicle ? 'LOCATION_VEHICLES' : null,
    id: r.id,
    name: r.name,
    slug: r.slug,
    subtitle: r.subtitle,
    tagline: r.tagline,
    description: r.description,
    features: parseFeatures(r.features),
    dailyRate: effective == null ? null : Number(effective),
    // The vehicle proxy already prefers the primary gallery photo, so this
    // stays the tile/hero source whether or not gallery rows exist.
    photoUrl: hasImage ? `/api/public/catalog-image/vehicle/${r.id}` : null,
    photos,
    specs: {
      baseVehicle: r.baseVehicle,
      model: r.model,
      fuelType: r.fuelType,
      lengthFt: r.lengthFt == null ? null : Number(r.lengthFt),
      heightClearance: r.heightClearance,
      interiorBoxHeight: r.interiorBoxHeight,
      liftGateSpec: r.liftGateSpec,
    },
  }
}


/**
 * Publicly-listed SUBCONTRACTED units, mapped into the same PublicVehicle
 * shape as the owned catalog.
 *
 * Two rules hold here, and both are enforced by the select rather than by
 * remembering:
 *   1. NO VENDOR. `vendor` is not selected, so a listed partner unit reads
 *      exactly like one of ours — the client should not be able to tell, which
 *      is the same rule the unlisted /unit/[token] page follows.
 *   2. LIST RATE ONLY. `discountPercent` is not selected. The client is quoted
 *      list, so the catalog price is the list rate and discloses nothing about
 *      what we pay.
 *
 * Listing is opt-in per unit (`publiclyListed`) and needs a slug and a photo —
 * an entry that renders as a placeholder is worse than no entry.
 */
/**
 * The partner's SIGNATURE is the switch (Wes 2026-09-06: "the section should
 * be added as soon as David approves in the portal which we send to him").
 * A unit can be fully staged — listed, slug, photos — and it stays off the
 * site until the partner has signed the live Partner Vehicle Agreement. The
 * moment they sign, the next render shows it. Shared with the photo proxy so
 * an unsigned partner's gallery is not reachable by id either.
 */
export const PARTNER_APPROVED_VENDOR_WHERE: Prisma.VendorWhereInput = {
  isActive: true,
  agreements: { some: { deletedAt: null, signedAt: { not: null } } },
}

export const SUB_LISTED_WHERE: Prisma.SubcontractedVehicleWhereInput = {
  // A unit the partner keeps for themselves in their HQ workspace is not ours to list.
  offeredToSirReel: true,
  isActive: true,
  publiclyListed: true,
  publicSlug: { not: null },
  photos: { some: {} },
  vendor: PARTNER_APPROVED_VENDOR_WHERE,
}

/**
 * Where partner units sit on /vehicles: one section per CATEGORY (see
 * partnerSections.ts), every partner side by side inside it — the client
 * sees a SirReel category, never a vendor. Owned categories keep the main
 * grid. Until PowerTrip (2026-09-10) there was one section, motorhomes &
 * trailers; a generator partner made the section a property of the unit.
 */
export interface PartnerCatalogGroup {
  meta: PartnerSectionMeta
  items: PublicVehicle[]
}

/**
 * Sectioned units grouped in page order, empties dropped.
 *
 * Membership is `section`, not `partner` (2026-09-10): an owned restroom
 * trailer and a partner's motorhome are both Specialty Vehicles, and a
 * client reading the page has no reason to care which one we own. The two
 * catalog rules the sections have always had still hold — no vendor named,
 * list rate only — and they hold for the owned rows trivially.
 */
export function groupPartnerUnits(items: PublicVehicle[]): PartnerCatalogGroup[] {
  const by = new Map<PartnerCatalogSectionKey, PublicVehicle[]>()
  for (const v of items) {
    if (!v.section) continue
    by.set(v.section, [...(by.get(v.section) ?? []), v])
  }
  return [...PARTNER_SECTIONS]
    .sort((a, b) => a.order - b.order)
    .filter((m) => (by.get(m.key)?.length ?? 0) > 0)
    .map((m) => ({ meta: m, items: by.get(m.key)! }))
}

type SubRow = {
  id: string
  name: string
  publicSlug: string | null
  vehicleType: string | null
  publicDescription: string | null
  specs: string | null
  listDailyRate: unknown
  catalogSection: string | null
  /** The section default, plus the name AND the permission to use it — the
   *  two travel together so a name can never be rendered without its flag. */
  vendor: { catalogSection: string | null; name: string; nameClientFacing: boolean }
  photos: { id: string }[]
}

function shapeSub(v: SubRow): PublicVehicle {
  const rate = v.listDailyRate == null ? null : Number(v.listDailyRate)
  const photos = v.photos.map((p, i) => ({
    id: p.id,
    src: `/api/public/catalog-image/sub-vehicle-photo/${p.id}`,
    isPrimary: i === 0,
  }))
  return {
    partner: true,
    suppliedBy: partnerAttribution(v.vendor),
    section: resolvePartnerSection(v, v.vendor).key,
    id: v.id,
    name: v.name,
    slug: v.publicSlug!,
    subtitle: v.vehicleType,
    tagline: null,
    // publicDescription, never the staff-facing `description` — the latter
    // carries operational caveats aimed at reps.
    description: v.publicDescription,
    features: parseFeatures(v.specs),
    dailyRate: Number.isFinite(rate as number) ? (rate as number) : null,
    photoUrl: photos[0]?.src ?? null,
    photos,
    specs: {
      baseVehicle: null, model: null, fuelType: null, lengthFt: null,
      heightClearance: null, interiorBoxHeight: null, liftGateSpec: null,
    },
  }
}

const SUB_SELECT: Prisma.SubcontractedVehicleSelect = {
  id: true, name: true, publicSlug: true, vehicleType: true,
  publicDescription: true, specs: true, listDailyRate: true,
  catalogSection: true,
  // The vendor's SECTION default only. Name, contact and money stay
  // unselected — rule 1 above.
  vendor: { select: { catalogSection: true, ...PARTNER_ATTRIBUTION_SELECT } },
  photos: {
    select: { id: true },
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  },
}

export async function getPublicVehicles(): Promise<PublicVehicle[]> {
  const rows = (await prisma.vehicleCategory.findMany({
    where: PUBLIC_VEHICLE_VISIBLE_WHERE,
    select: SELECT,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })) as unknown as Row[]
  const subs = await prisma.subcontractedVehicle.findMany({
    where: SUB_LISTED_WHERE,
    select: SUB_SELECT,
    orderBy: { name: 'asc' },
  }) as unknown as SubRow[]
  return [...rows.map(shape), ...subs.map(shapeSub)]
}

export async function getPublicVehicleBySlug(slug: string): Promise<PublicVehicle | null> {
  const row = (await prisma.vehicleCategory.findFirst({
    where: { slug, ...PUBLIC_VEHICLE_VISIBLE_WHERE },
    select: SELECT,
  })) as unknown as Row | null
  if (row) return shape(row)
  // Fall through to the subcontracted roster — one slug space, so a listed
  // partner unit resolves at /vehicles/[slug] like any other.
  const sub = await prisma.subcontractedVehicle.findFirst({
    where: { publicSlug: slug, ...SUB_LISTED_WHERE },
    select: SUB_SELECT,
  }) as unknown as SubRow | null
  return sub ? shapeSub(sub) : null
}
