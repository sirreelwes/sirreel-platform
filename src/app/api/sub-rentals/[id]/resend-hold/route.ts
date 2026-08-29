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
 * Deliberately does NOT flip status: the row is already REQUESTED, and
 * re-stamping it would misdate when the client said yes. It also refuses on
 * ESTIMATED — nobody has accepted, so "please hold" would be a lie. Use the
 * client's approval (or PATCH) to get there.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSubRentalAccess } from '@/lib/sub-rentals/auth'
import { sendHoldRequest } from '@/lib/sub-rentals/requestOnApproval'

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
      order: { select: { jobId: true, job: { select: { jobCode: true } }, agent: { select: { name: true, email: true } } } },
    },
  })
  if (!sub) return NextResponse.json({ error: 'not found' }, { status: 404 })

  if (sub.status === 'ESTIMATED') {
    return NextResponse.json(
      { error: 'Nobody has accepted this yet — asking the partner to hold would be wrong. Approve the quote first.' },
      { status: 409 },
    )
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
    flip: false,
  })
  if (!outcome) return NextResponse.json({ error: 'not found' }, { status: 404 })

  await prisma.auditLog.create({
    data: {
      action: 'sub_rental.hold_resent',
      entityType: 'SubRental',
      entityId: sub.id,
      userId: user.id,
      newValues: {
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
