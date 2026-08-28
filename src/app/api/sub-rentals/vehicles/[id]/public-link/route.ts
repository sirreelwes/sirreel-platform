/**
 * /api/sub-rentals/vehicles/[id]/public-link
 *
 *   POST   → mint (or re-mint) the unlisted client page. Re-minting is a
 *            deliberate revoke-and-replace: the previous URL dies, which is
 *            the recovery path when a link has been forwarded somewhere it
 *            shouldn't have gone.
 *   DELETE → revoke. The page 404s immediately for everyone holding it.
 *
 * Auth: requireSubVehicleAccess, same gate as the rest of the roster —
 * minting a client-facing surface is at least as sensitive as reading the
 * rate card. Both verbs write an AuditLog row: a link that exposes a unit
 * to anyone holding it should never appear without a name attached to it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSubVehicleAccess } from '@/lib/sub-rentals/auth'
import { mintPublicUnitToken, revokePublicUnitToken, publicUnitPath } from '@/lib/sub-rentals/publicUnit'
import { PUBLIC_SITE_ORIGIN } from '@/lib/site/publicUrl'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

export async function POST(_req: NextRequest, { params }: Params) {
  const gate = await requireSubVehicleAccess()
  if (gate instanceof NextResponse) return gate
  const { user } = gate

  const vehicle = await prisma.subcontractedVehicle.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, publicToken: true, _count: { select: { photos: true } } },
  })
  if (!vehicle) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (vehicle._count.photos === 0) {
    return NextResponse.json(
      { error: 'Add at least one photo before publishing a client page.' },
      { status: 400 },
    )
  }

  const replacing = vehicle.publicToken != null
  const token = await mintPublicUnitToken(vehicle.id)

  await prisma.auditLog.create({
    data: {
      action: replacing ? 'sub_vehicle.public_link_reminted' : 'sub_vehicle.public_link_minted',
      entityType: 'SubcontractedVehicle',
      entityId: vehicle.id,
      userId: user.id,
      newValues: { vehicleName: vehicle.name, replacedPreviousLink: replacing },
    },
  })

  return NextResponse.json({ ok: true, token, url: `${PUBLIC_SITE_ORIGIN}${publicUnitPath(token)}` })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const gate = await requireSubVehicleAccess()
  if (gate instanceof NextResponse) return gate
  const { user } = gate

  const vehicle = await prisma.subcontractedVehicle.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, publicToken: true },
  })
  if (!vehicle) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!vehicle.publicToken) return NextResponse.json({ ok: true, token: null })

  await revokePublicUnitToken(vehicle.id)
  await prisma.auditLog.create({
    data: {
      action: 'sub_vehicle.public_link_revoked',
      entityType: 'SubcontractedVehicle',
      entityId: vehicle.id,
      userId: user.id,
      newValues: { vehicleName: vehicle.name },
    },
  })

  return NextResponse.json({ ok: true, token: null })
}
