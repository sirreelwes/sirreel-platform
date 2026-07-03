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
import { prisma } from '@/lib/prisma'
import { pickEffectiveDailyRate } from '@/lib/pricing/resolveRate'

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
    { assetCategory: { imageUrl: { not: null } } },
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
  assetCategory: { select: { dailyRate: true, imageUrl: true } },
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
  assetCategory: { dailyRate: unknown; imageUrl: string | null } | null
  photos: { id: string; isPrimary: boolean }[]
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
  const hasImage = photos.length > 0 || !!(r.photoUrl || r.assetCategory?.imageUrl)
  return {
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

export async function getPublicVehicles(): Promise<PublicVehicle[]> {
  const rows = (await prisma.vehicleCategory.findMany({
    where: PUBLIC_VEHICLE_VISIBLE_WHERE,
    select: SELECT,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })) as unknown as Row[]
  return rows.map(shape)
}

export async function getPublicVehicleBySlug(slug: string): Promise<PublicVehicle | null> {
  const row = (await prisma.vehicleCategory.findFirst({
    where: { slug, ...PUBLIC_VEHICLE_VISIBLE_WHERE },
    select: SELECT,
  })) as unknown as Row | null
  return row ? shape(row) : null
}
