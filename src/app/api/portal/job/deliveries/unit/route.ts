/**
 * POST /api/portal/job/deliveries/unit — the production sets THIS unit's call
 * time and a note for its driver.
 *
 * The address is job-wide (the sibling route); the call time is per unit
 * because a motorhome and a restroom trailer on the same lot don't report at
 * the same hour, and the note is per unit because it's for a specific driver.
 *
 * Scoping, same rule as every portal route: the session resolves to one
 * order → one job, and the sub-rental must hang off THAT job — by jobId or
 * through its order. A guessed id on another production's unit is a 403.
 *
 * Saving tells the partner and (if named) the driver, through the conduit,
 * in the background. This is the moment Wes described: "the client will see
 * the driver info and be able to send call time etc to the driver".
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { JOB_SESSION_COOKIE, verifyJobSessionCookieValue } from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { loadDeliveries } from '@/lib/portal/deliveries'
import { notifyLogisticsChanged, receivesLogistics } from '@/lib/sub-rentals/conduit'

export const dynamic = 'force-dynamic'

const LIMITS = { callTime: 120, driverNotes: 1000 } as const

async function jobIdForSession(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) return null
  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) return null
  const order = await prisma.order.findUnique({ where: { id: resolved.orderId }, select: { jobId: true } })
  if (!order?.jobId) return null
  return { jobId: order.jobId, contactId: resolved.contact?.id ?? null }
}

export async function POST(req: NextRequest) {
  const ctx = await jobIdForSession(req)
  if (!ctx) return NextResponse.json({ error: 'No session' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const unitId = String(body.unitId ?? '')
  if (!unitId.startsWith('sub:')) {
    return NextResponse.json({ error: 'Call time can only be set on a delivered unit.' }, { status: 400 })
  }
  const subRentalId = unitId.slice(4)

  const data: { callTime?: string | null; driverNotes?: string | null } = {}
  for (const key of ['callTime', 'driverNotes'] as const) {
    if (!(key in body)) continue
    const raw = body[key]
    if (raw !== null && typeof raw !== 'string') return NextResponse.json({ error: 'Text only.' }, { status: 400 })
    const trimmed = (raw ?? '').toString().trim()
    if (trimmed.length > LIMITS[key]) {
      return NextResponse.json({ error: `Too long (max ${LIMITS[key]} characters).` }, { status: 400 })
    }
    data[key] = trimmed || null
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })

  // The scoping check — both linkage shapes, re-derived from the session.
  const sub = await prisma.subRental.findFirst({
    where: { id: subRentalId, OR: [{ jobId: ctx.jobId }, { order: { jobId: ctx.jobId } }] },
    select: { id: true, status: true, callTime: true, driverNotes: true },
  })
  if (!sub) return NextResponse.json({ error: 'That unit is not on your job.' }, { status: 403 })
  if (sub.status === 'CANCELLED') return NextResponse.json({ error: 'That unit is no longer coming.' }, { status: 409 })

  const unchanged =
    (!('callTime' in data) || data.callTime === sub.callTime) &&
    (!('driverNotes' in data) || data.driverNotes === sub.driverNotes)
  if (unchanged) return NextResponse.json(await loadDeliveries(ctx.jobId))

  const now = new Date()
  await prisma.subRental.update({ where: { id: sub.id }, data: { ...data, logisticsUpdatedAt: now } })

  await prisma.auditLog.create({
    data: {
      action: 'sub_rental.call_time_updated',
      entityType: 'SubRental',
      entityId: sub.id,
      userId: null,
      oldValues: { callTime: sub.callTime, driverNotes: sub.driverNotes },
      newValues: { ...data, byPortalContactId: ctx.contactId },
    },
  })

  if (receivesLogistics(sub.status)) {
    void notifyLogisticsChanged({ jobId: ctx.jobId, subRentalIds: [sub.id], at: now }).catch((err) =>
      console.warn('[portal/deliveries/unit] conduit notify failed:', err instanceof Error ? err.message : err),
    )
  }

  return NextResponse.json(await loadDeliveries(ctx.jobId))
}
