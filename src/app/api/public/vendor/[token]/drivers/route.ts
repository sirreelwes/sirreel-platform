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
import { vendorBookingWhere } from '@/lib/sub-rentals/potentialSubRental'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'

export const dynamic = 'force-dynamic'

/** Every POST can send an invite email. Room for a partner putting a whole
 *  crew on at once; not room for a loop mailing strangers from our domain. */
const INVITE_RATE = { windowMs: 10 * 60_000, max: 20 }

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  if (!checkRateLimit(`vendor-drivers:${clientIp(req)}`, INVITE_RATE).ok) {
    return NextResponse.json({ error: 'That is a lot of invites at once — give it a few minutes.' }, { status: 429 })
  }
  const token = params.token
  if (!token || token.length < 32) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const sub = await prisma.subRental.findFirst({
    where: vendorBookingWhere(token),
    select: { id: true, status: true, vendorId: true, subcontractedVehicleId: true },
  })
  if (!sub) return NextResponse.json({ error: 'not found' }, { status: 404 })
  // A closed booking's link is not a standing way to mail invites.
  if (sub.status === 'CANCELLED' || sub.status === 'RETURNED') {
    return NextResponse.json({ error: 'This booking is closed.' }, { status: 409 })
  }

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
  if (body.assign === true) {
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
