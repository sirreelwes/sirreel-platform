/**
 * GET  /api/jobs/[id]/blind-handoff — the job's live orders and every live
 *      vehicle with its effective blind pickup / return.
 * POST /api/jobs/[id]/blind-handoff — flip blind for the whole job, or for
 *      one vehicle.
 *
 *   { kind: 'blindPickup' | 'blindReturn', value: boolean, assignmentId?: string }
 *
 * With `assignmentId` the write is the vehicle's OVERRIDE (Jose 2026-09-16:
 * "only mark certain vehicles as blind"). Without it the write is job-wide:
 * every live order's flag, AND every vehicle override on this edge reset
 * to null — so "the whole job is blind" is exactly that, with no unit
 * quietly keeping an older per-vehicle answer. Both return the new state.
 *
 * Not gated on the sales permission on purpose (Wes 2026-09-15: "always
 * allow the fleet guy to change to a blind pickup") — any HQ session.
 *
 * A flip that changes a vehicle's EFFECTIVE answer also tells the drivers
 * named on it (Jose 2026-09-18): their invite's "nobody will meet you"
 * was computed once, at send time, so the only message they hold can say
 * the opposite of what is now true. Best-effort and diffed either side of
 * the write — see lib/drivers/driverChangeNotice. The response carries
 * `notices` so the chip can say who was reached.
 * Rule + shapes: src/lib/fleet/blindHandoff.ts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { loadJobBlindState } from '@/lib/fleet/blindHandoff'
import { notifyDriversOfBlindChange } from '@/lib/drivers/driverChangeNotice'

export const dynamic = 'force-dynamic'

const KINDS = new Set(['blindPickup', 'blindReturn'])

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const job = await prisma.job.findUnique({ where: { id }, select: { id: true } })
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 })
  return NextResponse.json(await loadJobBlindState(id))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  let body: { kind?: string; value?: unknown; assignmentId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const kind = body.kind
  if (!kind || !KINDS.has(kind)) return NextResponse.json({ error: 'kind must be blindPickup or blindReturn' }, { status: 400 })
  if (typeof body.value !== 'boolean') return NextResponse.json({ error: 'value must be a boolean' }, { status: 400 })
  const value = body.value
  const assignmentId = typeof body.assignmentId === 'string' && body.assignmentId ? body.assignmentId : null

  const job = await prisma.job.findUnique({ where: { id }, select: { id: true } })
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 })

  // Read BEFORE the write: the notice is a diff of effective answers, and
  // a job-wide flip resets overrides, so "what it was" cannot be
  // reconstructed afterwards.
  const beforeState = await loadJobBlindState(id)
  const actor = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })

  const liveVehicleWhere: Prisma.BookingAssignmentWhereInput = {
    status: { in: ['ASSIGNED', 'CHECKED_OUT'] },
    bookingItem: { booking: { jobId: id, status: { notIn: ['CANCELLED', 'ARCHIVED'] }, archivedAt: null } },
  }

  if (assignmentId) {
    // One vehicle. It must be a live unit on THIS job — never write a
    // stranger's assignment from a job's URL.
    const owned = await prisma.bookingAssignment.findFirst({
      where: { id: assignmentId, ...liveVehicleWhere },
      select: { id: true },
    })
    if (!owned) return NextResponse.json({ error: 'that vehicle is not on this job' }, { status: 404 })
    await prisma.bookingAssignment.update({ where: { id: assignmentId }, data: { [kind]: value } })
  } else {
    // Whole job: the order flags carry it, the overrides step aside.
    const orders = await prisma.order.findMany({
      where: { jobId: id, status: { not: 'CANCELLED' } },
      select: { id: true },
    })
    if (orders.length === 0) {
      return NextResponse.json({ error: 'Blind handoff is set on the order — write the order first' }, { status: 409 })
    }
    await prisma.$transaction([
      prisma.order.updateMany({ where: { id: { in: orders.map((o) => o.id) } }, data: { [kind]: value } }),
      prisma.bookingAssignment.updateMany({ where: liveVehicleWhere, data: { [kind]: null } }),
    ])
  }

  const afterState = await loadJobBlindState(id)
  const notices = await notifyDriversOfBlindChange(beforeState, afterState, actor?.id ?? null)
  return NextResponse.json({ ...afterState, notices })
}
