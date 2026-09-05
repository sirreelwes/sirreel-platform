/**
 * POST /api/sub-rentals/[id]/resend-hold — ask a partner to hold, again.
 *
 * The approval hook's failure posture leaves a precise remainder: rows that
 * are REQUESTED (the client's yes is durable) with a null
 * `vendorHoldRequestedAt` (the notice never actually left). That is a partner
 * who still believes their unit is free while a client is committed to it, and
 * before this endpoint the only fix was to mail them by hand.
 *
 * Shares `sendHoldRequest` with the approval hook rather than composing a
 * second notice — the thing a fork would break first is the conduit rule.
 *
 * Deliberately does NOT flip status on a REQUESTED row: re-stamping it would
 * misdate when the client said yes. It refuses on ESTIMATED when nobody has
 * accepted — "please hold" would be a lie. But an ESTIMATED row whose ORDER
 * is approved or booked is the other silent state (the client said yes
 * through HQ and the hook never ran, 2026-09-05): there the client's yes IS
 * durable, so this flips ESTIMATED → REQUESTED and sends, exactly as the
 * approval hook would have.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSubRentalAccess } from '@/lib/sub-rentals/auth'
import { sendHoldRequest } from '@/lib/sub-rentals/requestOnApproval'
import { isClientCommittedOrder } from '@/lib/sub-rentals/commitment'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const gate = await requireSubRentalAccess()
  if (gate instanceof NextResponse) return gate
  const { user } = gate

  const sub = await prisma.subRental.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      orderId: true,
      jobId: true,
      job: { select: { jobCode: true } },
      order: { select: { status: true, jobId: true, job: { select: { jobCode: true } }, agent: { select: { name: true, email: true } } } },
    },
  })
  if (!sub) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Same commitment test the job panel uses: the linked order, or for a
  // job-level row (estimate flow, no order yet) any committed order on the job.
  let flip = false
  if (sub.status === 'ESTIMATED') {
    let committed = sub.order ? isClientCommittedOrder(sub.order.status) : false
    if (!committed && !sub.order && sub.jobId) {
      const jobOrders = await prisma.order.findMany({
        where: { jobId: sub.jobId, archivedAt: null },
        select: { status: true },
      })
      committed = jobOrders.some((o) => isClientCommittedOrder(o.status))
    }
    if (!committed) {
      return NextResponse.json(
        { error: 'Nobody has accepted this yet — asking the partner to hold would be wrong. Approve the quote first.' },
        { status: 409 },
      )
    }
    flip = true
  }
  if (sub.status === 'CANCELLED' || sub.status === 'RETURNED') {
    return NextResponse.json(
      { error: `This sub-rental is ${sub.status.toLowerCase()} — there is nothing to hold.` },
      { status: 409 },
    )
  }

  // The sending rep signs it and takes the reply. Prefer the order's agent
  // (whose job this is) over whoever happens to be clicking; fall back to the
  // clicker so a row with no order still gets a real human on Reply-To.
  const agent = sub.order?.agent
  const outcome = await sendHoldRequest({
    subRentalId: sub.id,
    jobCode: sub.job?.jobCode ?? sub.order?.job?.jobCode ?? null,
    agentName: agent?.name ?? user.name ?? null,
    agentEmail: agent?.email ?? user.email ?? null,
    orderId: sub.orderId,
    flip,
  })
  if (!outcome) return NextResponse.json({ error: 'not found' }, { status: 404 })

  await prisma.auditLog.create({
    data: {
      action: flip ? 'sub_rental.hold_requested' : 'sub_rental.hold_resent',
      entityType: 'SubRental',
      entityId: sub.id,
      userId: user.id,
      ...(flip ? { oldValues: { status: 'ESTIMATED' } } : {}),
      newValues: {
        ...(flip ? { status: 'REQUESTED' } : {}),
        vendor: outcome.vendorName,
        vehicle: outcome.vehicleName,
        notified: outcome.notified,
        warning: outcome.warning,
        via: 'job-panel',
      },
    },
  }).catch((err) => console.error('[resend-hold] audit write failed:', err))

  if (!outcome.notified) {
    return NextResponse.json({ ok: false, error: outcome.warning }, { status: 502 })
  }
  return NextResponse.json({ ok: true, vendorName: outcome.vendorName })
}
