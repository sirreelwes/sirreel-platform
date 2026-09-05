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

export const dynamic = 'force-dynamic'

type Params = { params: { token: string } }

export async function POST(req: NextRequest, { params }: Params) {
  const token = params.token
  if (!token || token.length < 32) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const sub = await prisma.subRental.findFirst({
    where: { vendorToken: token },
    select: { id: true, status: true },
  })
  if (!sub) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (sub.status === 'CANCELLED') {
    return NextResponse.json({ error: 'This booking has been cancelled.' }, { status: 409 })
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
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
