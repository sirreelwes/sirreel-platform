import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { can } from '@/lib/permissions'
import { bookingInfoGaps } from '@/lib/scheduling/infoGaps'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/scheduling/bookings/[id]/info — finish a call-in reservation.
 *
 * A phoned-in hold can be created before the production company or the
 * job/show name exist (see POST /api/scheduling/holds and
 * src/lib/scheduling/infoGaps.ts). This is where the agent fills the
 * blanks in afterwards, from the gantt's reservation pop-up.
 *
 * Body (every field optional — send only what changed):
 *   companyId    string  — the production company
 *   jobId        string  — an EXISTING Job; this route creates none
 *   expectsOrder boolean — "an Order will be attached later"
 *
 * The Job is the authority on company: passing a jobId adopts its
 * companyId, and a companyId that contradicts it is refused.
 *
 * Amend rules — this fills BLANKS, it does not re-point a live booking:
 *   • company may be set when NULL; changing an existing one is refused
 *     once a Job or an Order is attached (that's a re-book, not a fix).
 *   • job may be set when absent; replacing one is refused.
 *   • expectsOrder is always toggleable.
 *
 * Gated on canCreateBooking (AGENT + ADMIN). No ownership check —
 * matching the status/dates routes, finishing a reservation is shared
 * coverage work (Wes 2026-08-21).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params

  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const actor = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true },
  })
  if (!actor || !can(actor.role, 'canCreateBooking')) {
    return NextResponse.json(
      { error: 'forbidden', reason: 'completing a reservation is a sales action' },
      { status: 403 },
    )
  }

  const body = (await req.json().catch(() => null)) as
    | { companyId?: string | null; jobId?: string | null; expectsOrder?: boolean }
    | null
  if (!body) return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })

  const wantsCompany = typeof body.companyId === 'string' && body.companyId.trim().length > 0
  const wantsJob = typeof body.jobId === 'string' && body.jobId.trim().length > 0
  const wantsExpects = typeof body.expectsOrder === 'boolean'
  if (!wantsCompany && !wantsJob && !wantsExpects) {
    return NextResponse.json(
      { error: 'nothing to update — send companyId, jobId and/or expectsOrder' },
      { status: 400 },
    )
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      companyId: true,
      jobId: true,
      jobName: true,
      expectsOrder: true,
      // Orders live on the JOB (Order.jobId is required; Order.bookingId
      // is unused in practice), so "an order is attached" is a job-level
      // fact — same source the gantt's order badge reads.
      job: { select: { id: true, name: true, orders: { where: { status: { not: 'CANCELLED' } }, select: { id: true } } } },
    },
  })
  if (!booking) return NextResponse.json({ error: 'booking not found' }, { status: 404 })

  const data: {
    companyId?: string
    jobId?: string
    jobName?: string
    expectsOrder?: boolean
  } = {}

  // ── Job first: it decides the company. ──
  if (wantsJob) {
    const jobId = body.jobId!.trim()
    if (booking.jobId && booking.jobId !== jobId) {
      return NextResponse.json(
        { error: 'this reservation is already on a job — move it from the job page, not here' },
        { status: 409 },
      )
    }
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true, name: true, companyId: true },
    })
    if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 })
    if (wantsCompany && body.companyId!.trim() !== job.companyId) {
      return NextResponse.json(
        { error: 'job belongs to a different company than the one you picked' },
        { status: 409 },
      )
    }
    if (booking.companyId && booking.companyId !== job.companyId) {
      return NextResponse.json(
        { error: 'job belongs to a different company than this reservation' },
        { status: 409 },
      )
    }
    data.jobId = job.id
    data.jobName = job.name
    data.companyId = job.companyId
  }

  // ── Company on its own (no job yet). ──
  if (wantsCompany && data.companyId === undefined) {
    const companyId = body.companyId!.trim()
    if (booking.companyId && booking.companyId !== companyId) {
      const locked = booking.jobId || (booking.job?.orders.length ?? 0) > 0
      if (locked) {
        return NextResponse.json(
          { error: 'this reservation already has a job or order — the client cannot be swapped here' },
          { status: 409 },
        )
      }
    }
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } })
    if (!company) return NextResponse.json({ error: 'company not found' }, { status: 404 })
    data.companyId = company.id
  }

  if (wantsExpects) data.expectsOrder = body.expectsOrder!

  const updated = await prisma.booking.update({
    where: { id },
    data,
    select: {
      id: true,
      companyId: true,
      jobId: true,
      jobName: true,
      expectsOrder: true,
      company: { select: { id: true, name: true } },
      job: {
        select: {
          id: true, jobCode: true, name: true,
          orders: { where: { status: { not: 'CANCELLED' } }, select: { id: true } },
        },
      },
    },
  })

  return NextResponse.json({
    ok: true,
    booking: {
      id: updated.id,
      companyId: updated.companyId,
      companyName: updated.company?.name ?? null,
      jobId: updated.jobId,
      jobCode: updated.job?.jobCode ?? null,
      jobName: updated.jobName,
      expectsOrder: updated.expectsOrder,
    },
    infoGaps: bookingInfoGaps({
      companyId: updated.companyId,
      jobId: updated.jobId,
      jobName: updated.jobName,
      expectsOrder: updated.expectsOrder,
      orderCount: updated.job?.orders.length ?? 0,
    }),
  })
}
