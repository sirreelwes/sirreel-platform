/**
 * POST /api/public/vendor/[token]/drivers — the partner adds a driver to
 * their roster by EMAIL (optionally a name), which sends the driver a link
 * to complete their profile. `assign: true` also puts them on THIS booking.
 * Re-posting an existing address re-sends the link ("Resend").
 *
 * Token-gated like the rest of the vendor page. The roster is the vendor's
 * (all their bookings share it); the assignment is this booking's.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { addVendorDriver, assignRosterDriver, rosterForVendor } from '@/lib/sub-rentals/vendorDrivers'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const token = params.token
  if (!token || token.length < 32) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const sub = await prisma.subRental.findFirst({
    where: { vendorToken: token },
    select: { id: true, status: true, vendorId: true, subcontractedVehicleId: true },
  })
  if (!sub) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const added = await addVendorDriver({
    vendorId: sub.vendorId,
    email: String(body.email ?? ''),
    name: typeof body.name === 'string' ? body.name : null,
  })
  if (!added.ok) return NextResponse.json({ error: added.error }, { status: 400 })

  await prisma.auditLog.create({
    data: {
      action: added.existed ? 'vendor_driver.invite_resent' : 'vendor_driver.added',
      entityType: 'VendorDriver',
      entityId: added.driverId,
      newValues: { vendorId: sub.vendorId, invited: added.invited, viaSubRentalId: sub.id, via: 'vendor-page' },
    },
  })

  let assignment: unknown = null
  if (body.assign === true && sub.status !== 'CANCELLED') {
    const a = await assignRosterDriver(sub.id, added.driverId)
    if (!a.ok) return NextResponse.json({ error: a.error }, { status: 400 })
    assignment = a
    await prisma.auditLog.create({
      data: {
        action: 'sub_rental.driver_assigned',
        entityType: 'SubRental',
        entityId: sub.id,
        newValues: { vendorDriverId: added.driverId, driverName: a.driverName, relayAddress: a.relayAddress, via: 'vendor-page' },
      },
    })
  }

  return NextResponse.json({
    ok: true,
    driverId: added.driverId,
    invited: added.invited,
    existed: added.existed,
    assignment,
    roster: await rosterForVendor(sub.vendorId, sub.subcontractedVehicleId),
  })
}
