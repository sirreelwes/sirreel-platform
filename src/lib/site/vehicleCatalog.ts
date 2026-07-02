/**
 * Live read helpers for the public /vehicles pages. Single source of truth is
 * the VehicleCategory table (same rows the order form shows). Price is resolved
 * the SAME way as /api/public/vehicle-categories: the linked Fleet Pricing
 * (AssetCategory.dailyRate) wins, else the row's own fallback, else
 * price-on-quote. Images go through the existing public proxy.
 */
import { prisma } from '@/lib/prisma'

export interface PublicVehicleSpec {
  baseVehicle: string | null
  model: string | null
  fuelType: string | null
  lengthFt: number | null
  heightClearance: string | null
  interiorBoxHeight: string | null
  liftGateSpec: string | null
}

export interface PublicVehicle {
  id: string
  name: string
  slug: string
  subtitle: string | null
  tagline: string | null
  description: string | null
  /** Resolved daily rate (number) or null = price-on-quote. */
  dailyRate: number | null
  /** Public image-proxy path, or null (→ placeholder). */
  photoUrl: string | null
  specs: PublicVehicleSpec
}

const SELECT = {
  id: true,
  name: true,
  slug: true,
  subtitle: true,
  tagline: true,
  description: true,
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
} as const

type Row = {
  id: string
  name: string
  slug: string
  subtitle: string | null
  tagline: string | null
  description: string | null
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
}

function shape(r: Row): PublicVehicle {
  const effective = r.assetCategory?.dailyRate ?? r.dailyRate
  const hasImage = !!(r.photoUrl || r.assetCategory?.imageUrl)
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    subtitle: r.subtitle,
    tagline: r.tagline,
    description: r.description,
    dailyRate: effective == null ? null : Number(effective),
    photoUrl: hasImage ? `/api/public/catalog-image/vehicle/${r.id}` : null,
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
    where: { active: true },
    select: SELECT,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })) as unknown as Row[]
  return rows.map(shape)
}

export async function getPublicVehicleBySlug(slug: string): Promise<PublicVehicle | null> {
  const row = (await prisma.vehicleCategory.findFirst({
    where: { slug, active: true },
    select: SELECT,
  })) as unknown as Row | null
  return row ? shape(row) : null
}
