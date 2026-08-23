import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { JOB_SESSION_COOKIE, verifyJobSessionCookieValue } from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { inviteDriver } from '@/lib/drivers/inviteDriver'

export const dynamic = 'force-dynamic'

/**
 * Client-side driver entry (Wes 2026-08-22: "the production client can
 * enter the driver on their job page").
 *
 * SCOPING IS THE WHOLE GAME HERE. The portal session resolves to ONE
 * order; a client must only ever see and assign vehicles on their own
 * job. So the vehicle list is derived from the session's order → job →
 * bookings → assignments, and POST re-derives that same set server-side
 * and refuses anything outside it. A caller cannot name a driver onto
 * another production's truck by guessing an id.
 *
 * The client sees vehicle + dates + who they've named. Never a licence
 * image, licence number, or another client's driver.
 */
async function resolveClientJobVehicles(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) return null
  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) return null

  const order = await prisma.order.findUnique({
    where: { id: resolved.orderId },
    select: { id: true, jobId: true },
  })
  if (!order?.jobId) return { resolved, jobId: null, assignmentIds: [] as string[] }

  const assignments = await prisma.bookingAssignment.findMany({
    where: { bookingItem: { booking: { jobId: order.jobId } } },
    orderBy: [{ startDate: 'asc' }],
    select: {
      id: true, startDate: true, endDate: true,
      asset: { select: { unitName: true, category: { select: { name: true } } } },
      driverAssignments: {
        where: { status: { not: 'CANCELLED' } },
        orderBy: { invitedAt: 'desc' },
        select: {
          id: true, status: true, emailSentTo: true, firstViewedAt: true,
          driver: { select: { firstName: true, lastName: true } },
        },
      },
    },
  })
  return { resolved, jobId: order.jobId, assignments, assignmentIds: assignments.map((a) => a.id) }
}

/** GET — the client's own vehicles and who they've named so far. */
export async function GET(req: NextRequest) {
  const ctx = await resolveClientJobVehicles(req)
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const assignments = ('assignments' in ctx ? ctx.assignments : []) ?? []
  return NextResponse.json({
    ok: true,
    vehicles: assignments.map((a) => ({
      bookingAssignmentId: a.id,
      unitName: a.asset.unitName,
      description: a.asset.category?.name ?? null,
      startDate: a.startDate.toISOString().slice(0, 10),
      endDate: a.endDate.toISOString().slice(0, 10),
      drivers: a.driverAssignments.map((d) => ({
        id: d.id,
        name: `${d.driver.firstName} ${d.driver.lastName}`.replace(/\s+—$/, '').trim(),
        email: d.emailSentTo,
        // Client-safe status only. They don't need (and shouldn't get)
        // our licence verdicts — "we're still waiting on them" is enough.
        opened: !!d.firstViewedAt,
        ready: d.status === 'READY' || d.status === 'PICKED_UP',
      })),
    })),
  })
}

/** POST { bookingAssignmentId, email, firstName? } — name a driver. */
export async function POST(req: NextRequest) {
  const ctx = await resolveClientJobVehicles(req)
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const bookingAssignmentId = String(body?.bookingAssignmentId ?? '').trim()
  const email = String(body?.email ?? '').trim()

  // The scoping check. Re-derived from the session, never trusted from
  // the request.
  if (!bookingAssignmentId || !ctx.assignmentIds.includes(bookingAssignmentId)) {
    return NextResponse.json({ error: 'That vehicle is not on your job.' }, { status: 403 })
  }

  try {
    const result = await inviteDriver({
      bookingAssignmentId,
      email,
      firstName: body?.firstName ?? null,
      lastName: body?.lastName ?? null,
      source: 'CLIENT',
      invitedByUserId: null,
    })
    // The client gets confirmation, never the driver's link — that link
    // is the driver's credential and belongs only in the driver's inbox.
    return NextResponse.json({ ok: true, emailSent: result.emailResult.ok })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not add that driver' },
      { status: 400 },
    )
  }
}
