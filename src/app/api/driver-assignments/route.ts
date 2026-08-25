import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { inviteDriver } from '@/lib/drivers/inviteDriver'

export const dynamic = 'force-dynamic'

/**
 * POST /api/driver-assignments — name a driver for a vehicle (STAFF entry).
 * Body: { bookingAssignmentId, email, firstName?, lastName?, phone? }
 *
 * Any signed-in staff session: sales agents name drivers as often as
 * warehouse does, and the destructive surface here is nil — it emails a
 * driver a link to their own job. The gate that matters is at handover.
 *
 * GET ?bookingAssignmentId= — who's already named for this vehicle.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const id = req.nextUrl.searchParams.get('bookingAssignmentId')
  if (!id) return NextResponse.json({ error: 'bookingAssignmentId required' }, { status: 400 })
  const rows = await prisma.driverAssignment.findMany({
    where: { bookingAssignmentId: id, status: { not: 'CANCELLED' } },
    orderBy: { invitedAt: 'desc' },
    select: {
      id: true, status: true, invitedAt: true, emailSentTo: true,
      firstViewedAt: true, invitedBySource: true,
      driver: {
        select: {
          id: true, firstName: true, lastName: true, phone: true,
          licenseFrontUrl: true, licenseBackUrl: true, licenseExpiry: true,
          licenseExpired: true, licenseVerified: true,
        },
      },
    },
  })
  return NextResponse.json({
    drivers: rows.map((r) => ({
      id: r.id,
      status: r.status,
      invitedAt: r.invitedAt,
      firstViewedAt: r.firstViewedAt,
      invitedBySource: r.invitedBySource,
      email: r.emailSentTo,
      driverId: r.driver.id,
      name: `${r.driver.firstName} ${r.driver.lastName}`.trim(),
      phone: r.driver.phone,
      // Booleans only — no licence URLs on a list surface.
      hasLicense: !!(r.driver.licenseFrontUrl || r.driver.licenseBackUrl),
      licenseVerified: r.driver.licenseVerified,
      licenseExpired: r.driver.licenseExpired,
      licenseExpiry: r.driver.licenseExpiry,
    })),
  })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const body = await req.json().catch(() => null)
  const bookingAssignmentId = String(body?.bookingAssignmentId ?? '').trim()
  const email = String(body?.email ?? '').trim()
  if (!bookingAssignmentId) {
    return NextResponse.json({ error: 'bookingAssignmentId is required' }, { status: 400 })
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  try {
    const result = await inviteDriver({
      bookingAssignmentId,
      email,
      firstName: body?.firstName ?? null,
      lastName: body?.lastName ?? null,
      phone: body?.phone ?? null,
      source: 'STAFF',
      invitedByUserId: user?.id ?? null,
    })
    return NextResponse.json({
      ok: true,
      driverAssignmentId: result.driverAssignmentId,
      needsLicense: result.needsLicense,
      // Surfaced so staff can hand over the link verbally when the email
      // bounces or the driver is standing right there.
      url: result.url,
      emailSent: result.emailResult.ok,
      emailError: result.emailResult.ok ? null : result.emailResult.reason,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not invite that driver' },
      { status: 400 },
    )
  }
}

/**
 * DELETE /api/driver-assignments — staff un-name a driver.
 * Body: { driverAssignmentId }
 *
 * Wider than the client's version on purpose. The client may only cancel a
 * PENDING driver (see api/portal/job/drivers): pulling someone who has
 * already cleared a licence check on pickup morning is how a truck ends up
 * with nobody able to take it. But that leaves a wrong READY driver
 * unfixable by anyone, so staff — who own the handover decision — can
 * cancel a READY one too.
 *
 * PICKED_UP is refused for everybody. Those keys are already gone, and
 * CheckoutRecord is the authoritative record of who took them; rewriting
 * the plan after the fact would only make the two disagree.
 *
 * Cancels rather than deletes so the audit trail of who was named, by whom,
 * survives — and expires the token, because that token is the driver's
 * no-login credential for the job page and the gate code.
 */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const body = await req.json().catch(() => null)
  const id = String(body?.driverAssignmentId ?? '').trim()
  if (!id) return NextResponse.json({ error: 'driverAssignmentId required' }, { status: 400 })

  const row = await prisma.driverAssignment.findUnique({
    where: { id },
    select: { id: true, status: true },
  })
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (row.status === 'CANCELLED') return NextResponse.json({ ok: true, alreadyCancelled: true })
  if (row.status === 'PICKED_UP') {
    return NextResponse.json(
      { error: 'That driver already collected the vehicle — the checkout record stands.' },
      { status: 409 },
    )
  }

  await prisma.driverAssignment.update({
    where: { id },
    data: { status: 'CANCELLED', expiresAt: new Date() },
  })
  return NextResponse.json({ ok: true })
}
