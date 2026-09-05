/**
 * /api/portal/job/deliveries — the client's own view of what's arriving.
 *
 *   GET  → units coming to them + the report-to address on file
 *   POST → save the report-to address
 *
 * ── Scoping is the whole game (same rule as /api/portal/job/drivers) ────────
 * The portal cookie resolves to ONE PortalAccess → one Order → one Job. Every
 * read and every write below derives the job id from that session and NEVER
 * from the request body. There is no `jobId` parameter to tamper with, so a
 * caller cannot read another production's deliveries or write an address onto
 * their job by guessing an id.
 *
 * ── Why POST is a client write at all ───────────────────────────────────────
 * The client is the only party who actually knows where a truck should report
 * — the gate, the lot, the cross-street — and they know it before we do. Same
 * reasoning that put driver entry in their hands on 2026-08-22. Staff can still
 * read it on the job page; nothing here is staff-writable, so there is one
 * author and no merge question.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { JOB_SESSION_COOKIE, verifyJobSessionCookieValue } from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { loadDeliveries, parseReportTo } from '@/lib/portal/deliveries'
import { liveSubRentalIdsForJob, notifyLogisticsChanged } from '@/lib/sub-rentals/conduit'

export const dynamic = 'force-dynamic'

/** Session → job id, or null. The single place the job is decided. */
async function jobIdForSession(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) return null
  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) return null
  const order = await prisma.order.findUnique({
    where: { id: resolved.orderId },
    select: { jobId: true },
  })
  if (!order?.jobId) return null
  return { jobId: order.jobId, contactId: resolved.contact?.id ?? null }
}

export async function GET(req: NextRequest) {
  const ctx = await jobIdForSession(req)
  if (!ctx) return NextResponse.json({ error: 'No session' }, { status: 401 })
  return NextResponse.json(await loadDeliveries(ctx.jobId))
}

export async function POST(req: NextRequest) {
  const ctx = await jobIdForSession(req)
  if (!ctx) return NextResponse.json({ error: 'No session' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const parsed = parseReportTo(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })
  }

  const before = await prisma.job.findUnique({
    where: { id: ctx.jobId },
    select: {
      reportToAddress: true,
      reportToAccessNotes: true,
      reportToTime: true,
      reportToContactName: true,
      reportToContactPhone: true,
      pickupSameAsDelivery: true,
      pickupAddress: true,
      pickupAccessNotes: true,
      pickupTime: true,
    },
  })

  const now = new Date()
  await prisma.job.update({
    where: { id: ctx.jobId },
    data: { ...parsed.data, reportToUpdatedAt: now },
  })

  // ── The conduit ──────────────────────────────────────────────────────────
  // Did anything a DRIVER acts on change? (The on-site phone number is
  // withheld from partners and drivers, so a phone-only edit tells nobody.)
  // If so: stamp every live sub-rental on the job NOW — synchronously, so
  // the response already shows the driver's confirmation as stale — then
  // tell the partners and their drivers in the background. A failed send
  // must never fail the client's save.
  const DRIVER_FACING = [
    'reportToAddress', 'reportToAccessNotes', 'reportToTime', 'reportToContactName',
    'pickupSameAsDelivery', 'pickupAddress', 'pickupAccessNotes', 'pickupTime',
  ] as const
  const changed = DRIVER_FACING.some(
    (k) => k in parsed.data && (before as Record<string, unknown> | null)?.[k] !== (parsed.data as Record<string, unknown>)[k],
  )
  if (changed) {
    const ids = await liveSubRentalIdsForJob(ctx.jobId)
    if (ids.length) {
      await prisma.subRental.updateMany({ where: { id: { in: ids } }, data: { logisticsUpdatedAt: now } })
      void notifyLogisticsChanged({ jobId: ctx.jobId, at: now }).catch((err) =>
        console.warn('[portal/deliveries] conduit notify failed:', err instanceof Error ? err.message : err),
      )
    }
  }

  // Audited because dispatch acts on this: if a truck goes to the wrong gate,
  // "what did the address say at 4pm and who changed it" is the first question.
  // userId is null — the author is the client, identified by their portal
  // contact, and there is no User row for them.
  await prisma.auditLog.create({
    data: {
      action: 'job.report_to_updated',
      entityType: 'Job',
      entityId: ctx.jobId,
      userId: null,
      oldValues: before ? (before as object) : undefined,
      newValues: { ...parsed.data, byPortalContactId: ctx.contactId },
    },
  })

  return NextResponse.json(await loadDeliveries(ctx.jobId))
}
