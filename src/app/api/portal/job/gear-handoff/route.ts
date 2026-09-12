import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  JOB_SESSION_COOKIE,
  buildJobSessionCookieHeader,
  verifyJobSessionCookieValue,
} from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { channelRecipients } from '@/lib/email/notificationChannels'

export const dynamic = 'force-dynamic'

/**
 * POST /api/portal/job/gear-handoff — the client saying how their gear leaves.
 *
 * Wes 2026-09-12: "orders have a drop down — Load on Asset 1, Load on Asset 2,
 * Will Call, Delivery." The order builder has asked this since the same day
 * (Order.gearHandoff / gearLoadsOnAssignmentId, written by from-parse); this
 * is the client's own answer to it, from the job portal.
 *
 * Body: { kind: 'LOAD_ON' | 'WILL_CALL' | 'DELIVERY', assignmentId?: string }
 *
 * LOAD_ON names one of the units reserved on THIS job — validated against the
 * job's own bookings, never trusted from the browser, so a client cannot point
 * their gear at somebody else's truck. DELIVERY is `Order.deliveryRequested`,
 * the flag dispatch already reads; picking it clears the load-on unit, and
 * picking either of the others clears the delivery flag. Nothing else in HQ
 * reads gearHandoff yet, so this changes no gate — it records an intention the
 * yard and dispatch can act on.
 *
 * The rep is told, because this is a logistics change they would otherwise
 * discover on pickup day.
 */
export async function POST(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) return NextResponse.json({ error: 'No session' }, { status: 401 })

  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) {
    const res = NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })
    res.headers.append('Set-Cookie', buildJobSessionCookieHeader('', { clear: true }))
    return res
  }

  const body = (await req.json().catch(() => ({}))) as { kind?: unknown; assignmentId?: unknown }
  const kind = body.kind
  if (kind !== 'LOAD_ON' && kind !== 'WILL_CALL' && kind !== 'DELIVERY') {
    return NextResponse.json({ error: 'kind must be LOAD_ON, WILL_CALL or DELIVERY' }, { status: 400 })
  }
  const assignmentId = typeof body.assignmentId === 'string' ? body.assignmentId : null

  const order = await prisma.order.findUnique({
    where: { id: resolved.orderId },
    select: {
      id: true,
      jobId: true,
      orderNumber: true,
      gearHandoff: true,
      gearLoadsOnAssignmentId: true,
      deliveryRequested: true,
      company: { select: { name: true } },
      job: { select: { id: true, name: true, jobCode: true } },
      agent: { select: { name: true, email: true } },
      jobContact: { select: { firstName: true, lastName: true, email: true } },
    },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // The unit has to be one reserved on this job. Checked server-side against
  // the job's bookings — the browser's id is a request, not a fact.
  let loadsOn: { id: string; unitName: string } | null = null
  if (kind === 'LOAD_ON') {
    if (!assignmentId) {
      return NextResponse.json({ error: 'Pick which vehicle it loads on.' }, { status: 400 })
    }
    const found = await prisma.bookingAssignment.findFirst({
      where: {
        id: assignmentId,
        status: { in: ['ASSIGNED', 'CHECKED_OUT', 'RETURNED'] },
        bookingItem: order.jobId
          ? { booking: { jobId: order.jobId } }
          : { booking: { orders: { some: { id: order.id } } } },
      },
      select: { id: true, asset: { select: { unitName: true } } },
    })
    if (!found) {
      return NextResponse.json(
        { error: 'That vehicle is not on this job any more — reload the page and pick again.' },
        { status: 400 },
      )
    }
    loadsOn = { id: found.id, unitName: found.asset?.unitName ?? 'the vehicle' }
  }

  const before = {
    gearHandoff: order.gearHandoff,
    gearLoadsOnAssignmentId: order.gearLoadsOnAssignmentId,
    deliveryRequested: order.deliveryRequested,
  }

  await prisma.order.update({
    where: { id: order.id },
    data: {
      gearHandoff: kind === 'DELIVERY' ? null : kind,
      gearLoadsOnAssignmentId: kind === 'LOAD_ON' ? loadsOn!.id : null,
      deliveryRequested: kind === 'DELIVERY',
    },
  })

  const who =
    [order.jobContact?.firstName, order.jobContact?.lastName].filter(Boolean).join(' ') ||
    order.jobContact?.email ||
    'The client'
  const choice =
    kind === 'LOAD_ON'
      ? `loaded on ${loadsOn!.unitName}`
      : kind === 'WILL_CALL'
        ? 'picked up at the warehouse (will call)'
        : 'delivered'

  await prisma.auditLog
    .create({
      data: {
        action: 'order.gear_handoff_client',
        entityType: 'Order',
        entityId: order.id,
        oldValues: before,
        newValues: {
          kind,
          gearLoadsOnAssignmentId: loadsOn?.id ?? null,
          byPortalAccessId: session.portalAccessId,
          byName: who,
        },
      },
    })
    .catch(() => null)

  // Fire and forget: the choice is stored, and a mail hiccup must not fail
  // the client's click.
  void (async () => {
    const to = order.agent?.email
      ? [order.agent.email]
      : await channelRecipients('hq-documents').catch(() => [] as string[])
    if (to.length === 0) return
    const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')
    const ctx = `${order.company?.name ?? 'A client'} — ${order.job?.name ?? ''} (${order.job?.jobCode ?? order.orderNumber})`
    const line = `${who} chose how the gear leaves on ${order.orderNumber}: ${choice}. They set it themselves in the job portal.`
    await sendAgreementEmail({
      to,
      subject: `Gear handoff set by the client — ${order.orderNumber}`,
      html: `<p>${line}</p><p><a href="${base}/orders/${order.id}">${base}/orders/${order.id}</a></p>`,
      text: `${line}\n\n${base}/orders/${order.id}`,
      label: 'portal-gear-handoff',
    }).catch(() => null)
  })()

  return NextResponse.json({
    ok: true,
    gearHandoff: { kind, assignmentId: loadsOn?.id ?? null },
  })
}
