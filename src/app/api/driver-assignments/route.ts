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
