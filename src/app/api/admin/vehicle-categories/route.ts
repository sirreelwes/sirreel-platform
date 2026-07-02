import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-admin'
import { pickEffectiveDailyRate } from '@/lib/pricing/resolveRate'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/vehicle-categories — list every VehicleCategory (active +
 * archived) with its public-site spec fields, for the HQ spec editor
 * (/admin/vehicle-catalog). The linked Fleet Pricing rate is included read-only
 * so the editor can show the live price alongside the specs.
 */
export async function GET() {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const rows = await prisma.vehicleCategory.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      slug: true,
      subtitle: true,
      active: true,
      dailyRate: true,
      baseVehicle: true,
      model: true,
      fuelType: true,
      lengthFt: true,
      heightClearance: true,
      interiorBoxHeight: true,
      liftGateSpec: true,
      tagline: true,
      description: true,
      assetCategory: { select: { dailyRate: true } },
    },
  })

  const categories = rows.map((r) => {
    const effective = pickEffectiveDailyRate(r)
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      subtitle: r.subtitle,
      active: r.active,
      dailyRate: effective == null ? null : Number(effective),
      baseVehicle: r.baseVehicle,
      model: r.model,
      fuelType: r.fuelType,
      lengthFt: r.lengthFt == null ? null : Number(r.lengthFt),
      heightClearance: r.heightClearance,
      interiorBoxHeight: r.interiorBoxHeight,
      liftGateSpec: r.liftGateSpec,
      tagline: r.tagline,
      description: r.description,
    }
  })

  return NextResponse.json({ categories })
}
