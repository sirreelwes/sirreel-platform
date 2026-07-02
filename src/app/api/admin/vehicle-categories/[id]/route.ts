import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-admin'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

// The editable public-site text spec fields. Empty string clears (→ null),
// otherwise the trimmed value is stored.
const TEXT_FIELDS = [
  'baseVehicle',
  'model',
  'fuelType',
  'heightClearance',
  'interiorBoxHeight',
  'liftGateSpec',
  'tagline',
  'description',
] as const

// Length in feet — Decimal(6,2). Accepts "10", "10.5"; empty clears; rejects
// negatives / junk / >2 decimals. Never goes through a JS float for storage.
function parseLengthFt(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v === undefined) return { ok: true, value: null } // treated as "no change" by caller
  const s = String(v).trim()
  if (s === '') return { ok: true, value: null }
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(s)) return { ok: false }
  return { ok: true, value: s }
}

/**
 * PATCH /api/admin/vehicle-categories/[id] — edit the public-site spec fields
 * of a VehicleCategory (the cards clients see on /vehicles). Whitelist-only:
 * ignores anything not in the spec set (name/slug/price live in Fleet Pricing).
 * These reflect LIVE on the public vehicle pages.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const data: Record<string, unknown> = {}

  for (const f of TEXT_FIELDS) {
    if (body[f] !== undefined) {
      const s = String(body[f] ?? '').trim()
      data[f] = s === '' ? null : s
    }
  }

  if (body.lengthFt !== undefined) {
    const parsed = parseLengthFt(body.lengthFt)
    if (!parsed.ok) {
      return NextResponse.json(
        { error: 'lengthFt must be a non-negative number with up to 2 decimals' },
        { status: 400 },
      )
    }
    data.lengthFt = parsed.value
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'no editable fields provided' }, { status: 400 })
  }

  const updated = await prisma.vehicleCategory.update({
    where: { id },
    data,
    select: {
      id: true,
      baseVehicle: true,
      model: true,
      fuelType: true,
      lengthFt: true,
      heightClearance: true,
      interiorBoxHeight: true,
      liftGateSpec: true,
      tagline: true,
      description: true,
    },
  })

  return NextResponse.json({
    ok: true,
    category: { ...updated, lengthFt: updated.lengthFt == null ? null : Number(updated.lengthFt) },
  })
}
