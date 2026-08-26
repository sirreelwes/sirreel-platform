import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { JOB_SESSION_COOKIE, verifyJobSessionCookieValue } from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { inviteDriver } from '@/lib/drivers/inviteDriver'
import type { DriverAssignmentStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * Statuses a CLIENT may cancel.
 *
 * Pending only, by Wes's call (2026-08-25). A READY driver has already
 * uploaded a licence we have checked, and PICKED_UP means they are holding
 * the keys — letting the client pull either on pickup morning is how a truck
 * ends up with nobody cleared to take it. Staff can still fix a wrong READY
 * driver; the client cannot.
 */
const CLIENT_CANCELLABLE: DriverAssignmentStatus[] = ['INVITED', 'VIEWED']

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
    where: {
      bookingItem: {
        booking: {
          jobId: order.jobId,
          // Match the staff job page, which skips CANCELLED/ARCHIVED
          // bookings. Without this the two disagreed: a client could see —
          // and name a driver onto — a vehicle whose booking was cancelled,
          // and that driver never appeared on the staff page, because the
          // vehicle itself was filtered out there. An invited driver nobody
          // at HQ could see. (Wes 2026-08-26: clients shouldn't see
          // cancelled bookings.)
          status: { notIn: ['CANCELLED', 'ARCHIVED'] },
        },
      },
    },
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
  // Held categories with no unit picked yet. A driver attaches to a UNIT,
  // so these have nothing to name a driver onto — but hiding them made the
  // whole section vanish on a job that is genuinely booked. Surfaced as a
  // waiting row instead, with no invite control.
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const pendingItems = await prisma.bookingItem.findMany({
    where: {
      booking: {
        jobId: order.jobId,
        status: { notIn: ['CANCELLED', 'ARCHIVED'] },
        // Live dates only. A finished job with an UNFULFILLED line would
        // otherwise tell the client we are "still assigning" a vehicle
        // they never got and no longer need.
        endDate: { gte: today },
      },
      assignments: { none: { status: { not: 'SWAPPED' } } },
    },
    select: {
      id: true, quantity: true,
      category: { select: { name: true } },
      booking: { select: { startDate: true, endDate: true } },
    },
  })
  const pendingHolds = pendingItems.map((it) => ({
    bookingItemId: it.id,
    description: it.category.name,
    quantity: it.quantity,
    startDate: it.booking.startDate.toISOString().slice(0, 10),
    endDate: it.booking.endDate.toISOString().slice(0, 10),
  }))

  return {
    resolved,
    jobId: order.jobId,
    assignments,
    pendingHolds,
    assignmentIds: assignments.map((a) => a.id),
  }
}

/** GET — the client's own vehicles and who they've named so far. */
export async function GET(req: NextRequest) {
  const ctx = await resolveClientJobVehicles(req)
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const assignments = ('assignments' in ctx ? ctx.assignments : []) ?? []
  return NextResponse.json({
    ok: true,
    pendingHolds: ('pendingHolds' in ctx ? ctx.pendingHolds : []) ?? [],
    vehicles: assignments.map((a) => ({
      bookingAssignmentId: a.id,
      unitName: a.asset.unitName,
      description: a.asset.category?.name ?? null,
      startDate: a.startDate.toISOString().slice(0, 10),
      endDate: a.endDate.toISOString().slice(0, 10),
      drivers: a.driverAssignments.map((d) => ({
        id: d.id,
        name: `${d.driver.firstName} ${d.driver.lastName}`.trim(),
        email: d.emailSentTo,
        // Client-safe status only. They don't need (and shouldn't get)
        // our licence verdicts — "we're still waiting on them" is enough.
        opened: !!d.firstViewedAt,
        ready: d.status === 'READY' || d.status === 'PICKED_UP',
        pickedUp: d.status === 'PICKED_UP',
        // The server decides removability, not the browser — the DELETE
        // re-checks it anyway, but this keeps the button off rows that
        // would only bounce.
        removable: CLIENT_CANCELLABLE.includes(d.status),
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


/**
 * DELETE — un-name a driver the client added by mistake, or who changed.
 *
 * Cancels rather than deletes: the row is the audit trail of who was named
 * and by whom, and both driver lists already filter `status: not CANCELLED`,
 * so a cancelled row drops out of the client's view and the staff board
 * without either query changing.
 *
 * Expiring the token is the point, not a detail. DriverAssignment.token is
 * the driver's no-login credential for the job page AND the gate code, so a
 * removed driver who keeps a live token is still able to walk up to the yard.
 */
export async function DELETE(req: NextRequest) {
  const ctx = await resolveClientJobVehicles(req)
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const driverAssignmentId = String(body?.driverAssignmentId ?? '').trim()
  if (!driverAssignmentId) {
    return NextResponse.json({ error: 'driverAssignmentId required' }, { status: 400 })
  }

  // Same scoping rule as POST: re-derive the client's own vehicles from the
  // session and refuse anything outside that set, so a guessed id cannot
  // cancel a driver on another production's truck.
  const row = await prisma.driverAssignment.findUnique({
    where: { id: driverAssignmentId },
    select: { id: true, status: true, bookingAssignmentId: true },
  })
  if (!row || !ctx.assignmentIds.includes(row.bookingAssignmentId)) {
    return NextResponse.json({ error: 'That driver is not on your job.' }, { status: 403 })
  }
  if (row.status === 'CANCELLED') {
    return NextResponse.json({ ok: true, alreadyCancelled: true })
  }
  if (!CLIENT_CANCELLABLE.includes(row.status)) {
    return NextResponse.json(
      {
        error:
          row.status === 'PICKED_UP'
            ? 'That driver already collected the vehicle — call us and we\'ll sort it out.'
            : 'That driver has already sent us their license. Call us and we\'ll swap them out.',
      },
      { status: 409 },
    )
  }

  await prisma.driverAssignment.update({
    where: { id: driverAssignmentId },
    data: { status: 'CANCELLED', expiresAt: new Date() },
  })
  return NextResponse.json({ ok: true })
}
