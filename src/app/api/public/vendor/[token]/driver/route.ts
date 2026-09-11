/**
 * POST /api/public/vendor/[token]/driver — the vendor names their driver.
 *
 * Token-gated exactly like the page it posts from: the vendor link is the
 * credential, and there is no vendor login to build. Assigning mints the relay
 * address (see lib/sub-rentals/driverRelay.ts) so production can reach the
 * driver without either side learning the other's address.
 *
 * The response deliberately returns the relay address to the VENDOR too — they
 * are the ones who have to tell their driver that mail will arrive from it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { assignDriver } from '@/lib/sub-rentals/driverRelay'
import { notifyDriverAssigned } from '@/lib/sub-rentals/conduit'
import { assignRosterDriver } from '@/lib/sub-rentals/vendorDrivers'
import { recordConsent } from '@/lib/sms/threads'
import { vendorBookingWhere } from '@/lib/sub-rentals/potentialSubRental'

export const dynamic = 'force-dynamic'

type Params = { params: { token: string } }

export async function POST(req: NextRequest, { params }: Params) {
  const token = params.token
  if (!token || token.length < 32) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const sub = await prisma.subRental.findFirst({
    where: vendorBookingWhere(token),
    select: { id: true, status: true },
  })
  if (!sub) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (sub.status === 'CANCELLED') {
    return NextResponse.json({ error: 'This booking has been cancelled.' }, { status: 409 })
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  // A delivered unit: name + mobile, no driver page, no relay, no fan-out.
  // The office texts or calls this person if the drop-off or pickup moves
  // on the day (Wes 2026-09-07). Email is optional and only stored.
  if (body.deliveryContact === true) {
    const name = typeof body.driverName === 'string' ? body.driverName.trim() : ''
    const phone = typeof body.driverPhone === 'string' ? body.driverPhone.trim() : ''
    const emailRaw = typeof body.driverEmail === 'string' ? body.driverEmail.trim().toLowerCase() : ''
    if (!name) return NextResponse.json({ error: 'A name is required.' }, { status: 400 })
    if (phone.replace(/\D/g, '').length < 10) return NextResponse.json({ error: 'A mobile number we can text or call is required.' }, { status: 400 })
    if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) return NextResponse.json({ error: 'That email address doesn’t look right.' }, { status: 400 })
    await prisma.subRental.update({
      where: { id: sub.id },
      data: { driverName: name, driverPhone: phone.slice(0, 30), driverEmail: emailRaw || null, driverAssignedAt: new Date() },
    })
    // The partner ticked "OK to text this number" on the same form as the
    // number — the affirmative opt-in the carrier campaign describes.
    const smsConsent = body.smsConsent === true
    if (smsConsent) await recordConsent(phone, 'partner-page').catch(() => false)
    await prisma.auditLog.create({
      data: {
        action: 'sub_rental.delivery_contact_set',
        entityType: 'SubRental',
        entityId: sub.id,
        newValues: { driverName: name, driverPhone: phone, driverEmail: emailRaw || null, smsConsent, via: 'vendor-page' },
      },
    })
    return NextResponse.json({ ok: true, driverName: name, driverPhone: phone, driverEmail: emailRaw || null })
  }

  // Roster path (2026-09-05): the partner picked one of their drivers for
  // THIS booking. Snapshot + link + fan-out all happen in assignRosterDriver.
  if (typeof body.vendorDriverId === 'string' && body.vendorDriverId) {
    const a = await assignRosterDriver(sub.id, body.vendorDriverId)
    if (!a.ok) return NextResponse.json({ error: a.error }, { status: 400 })
    await prisma.auditLog.create({
      data: {
        action: 'sub_rental.driver_assigned',
        entityType: 'SubRental',
        entityId: sub.id,
        newValues: { vendorDriverId: body.vendorDriverId, driverName: a.driverName, relayAddress: a.relayAddress, via: 'vendor-page' },
      },
    })
    return NextResponse.json(a)
  }

  // Legacy path: name + email typed straight in (kept for the older card).
  const res = await assignDriver({
    subRentalId: sub.id,
    driverName: typeof body.driverName === 'string' ? body.driverName : '',
    driverEmail: typeof body.driverEmail === 'string' ? body.driverEmail : '',
    driverPhone: typeof body.driverPhone === 'string' ? body.driverPhone : null,
  })
  if ('error' in res) return NextResponse.json({ error: res.error }, { status: 400 })

  await prisma.auditLog.create({
    data: {
      action: 'sub_rental.driver_assigned',
      entityType: 'SubRental',
      entityId: sub.id,
      // No userId: this is the vendor acting through their token, not a
      // signed-in member of staff.
      newValues: { driverName: res.driverName, relayAddress: res.relayAddress, via: 'vendor-page' },
    },
  })

  // The conduit: the driver gets their own page, the production hears who is
  // coming (Wes 2026-09-05). Awaited so the vendor's page can say whether the
  // driver was actually mailed; caught so a mail failure never undoes the
  // assignment itself.
  const fanout = await notifyDriverAssigned(sub.id).catch((err) => {
    console.warn('[vendor/driver] conduit fan-out failed:', err instanceof Error ? err.message : err)
    return { driverUrl: null, driverMailed: false, productionMailed: 0 }
  })

  return NextResponse.json({ ok: true, ...res, driverMailed: fanout.driverMailed, productionMailed: fanout.productionMailed })
}
