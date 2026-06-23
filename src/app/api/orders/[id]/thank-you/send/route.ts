/**
 * POST /api/orders/[id]/thank-you/send
 *
 * Sends the thank-you email through the standard Resend send path
 * (sendAgreementEmail). Goes from `notifications@sirreel.com` with
 * `replyTo: agent.email` so replies land in the agent's watched
 * inbox (jose@/oliver@/etc.) where the CRM capture pipeline already
 * processes them. A routing alias would take replies OUT of the
 * system we built.
 *
 * Body:
 *   {
 *     personalNote?: string | null,
 *     photoDocumentId?: string | null,
 *     to?: string,           // optional override (defaults to jobContact.email)
 *   }
 *
 * On success:
 *   - ThankYouSuggestion: status SUGGESTED → SENT, sentAt, sentToEmail,
 *     sentById, photoDocumentId (if newly picked), personalNote
 *   - AuditLog row: action='order.thank_you_sent'
 *
 * Auth: getServerSession; mutations require a known user.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { SEND_FROM, sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { buildThankYouEmail } from '@/lib/email/templates/thankYouTemplate'
import { orderPhotoProxyUrl } from '@/lib/orders/orderPhotoProxy'
import { ThankYouStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({})) as {
    personalNote?: string | null
    photoDocumentId?: string | null
    photoCaption?: string | null
    photoUrlOverride?: string | null
    to?: string
  }

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderNumber: true,
      endDate: true,
      jobContact: { select: { firstName: true, lastName: true, email: true } },
      job: { select: { name: true } },
      agent: { select: { id: true, name: true, email: true, displayTitle: true, phone: true } },
      thankYouSuggestion: { select: { id: true, status: true, photoDocumentId: true } },
    },
  })
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })
  if (!order.agent) return NextResponse.json({ error: 'order has no agent' }, { status: 422 })
  if (!order.thankYouSuggestion) {
    return NextResponse.json({ error: 'no thank-you suggestion for this order' }, { status: 404 })
  }
  if (order.thankYouSuggestion.status === ThankYouStatus.SENT) {
    return NextResponse.json({ error: 'thank-you already sent' }, { status: 409 })
  }

  const to = body.to?.trim() || order.jobContact?.email
  if (!to) return NextResponse.json({ error: 'no recipient (jobContact has no email and no override supplied)' }, { status: 422 })

  // Resolve photo URL. Priority:
  //   1) photoUrlOverride (weekly-candid path, not an OrderDocument)
  //   2) explicit photoDocumentId (rep picked an order JOB_PHOTO)
  //   3) suggestion's pinned photoDocumentId
  //   4) latest JOB_PHOTO uploaded to this order
  let photoDocumentId: string | null = body.photoUrlOverride
    ? null
    : (body.photoDocumentId ?? order.thankYouSuggestion.photoDocumentId)
  // Order JOB_PHOTOs live in the private blob store, so the email must
  // embed the PUBLIC-by-uuid proxy URL, not the raw (403) blob URL.
  // photoUrlOverride is the weekly-candid path (a User candid blob, not
  // an OrderDocument); that blob is ALSO private and would 403 in the
  // recipient's inbox — a separate pre-existing gap that needs its own
  // public proxy, untouched by this order-document fix.
  let photoUrl: string | null = body.photoUrlOverride ?? null
  if (!photoUrl && photoDocumentId) {
    const doc = await prisma.orderDocument.findUnique({
      where: { id: photoDocumentId },
      select: { orderId: true },
    })
    if (doc && doc.orderId === id) photoUrl = orderPhotoProxyUrl(photoDocumentId)
    else photoDocumentId = null
  }
  if (!photoUrl && !body.photoUrlOverride) {
    const latest = await prisma.orderDocument.findFirst({
      where: { orderId: id, type: 'JOB_PHOTO' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (latest) {
      photoUrl = orderPhotoProxyUrl(latest.id)
      photoDocumentId = latest.id
    }
  }

  const rendered = buildThankYouEmail({
    clientFirstName: order.jobContact?.firstName ?? null,
    clientFullName: order.jobContact
      ? `${order.jobContact.firstName} ${order.jobContact.lastName}`.trim()
      : null,
    jobName: order.job?.name ?? null,
    orderNumber: order.orderNumber,
    wrapDate: order.endDate ? order.endDate.toISOString() : null,
    agentName: order.agent.name,
    agentDisplayTitle: order.agent.displayTitle,
    agentEmail: order.agent.email,
    agentPhone: order.agent.phone,
    photoUrl,
    photoCaption: body.photoCaption ?? null,
    personalNote: body.personalNote ?? null,
  })

  const result = await sendAgreementEmail({
    to: [to],
    replyTo: order.agent.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    label: `thank-you:${order.orderNumber}`,
  })
  if (!result.ok) {
    return NextResponse.json({ error: `send failed: ${result.reason}` }, { status: 500 })
  }

  await prisma.thankYouSuggestion.update({
    where: { id: order.thankYouSuggestion.id },
    data: {
      status: ThankYouStatus.SENT,
      sentAt: new Date(),
      sentToEmail: to,
      sentById: user.id,
      personalNote: body.personalNote ?? null,
      photoDocumentId,
    },
  })

  // Audit trail.
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'order.thank_you_sent',
      entityType: 'order',
      entityId: id,
      newValues: {
        to,
        from: SEND_FROM,
        replyTo: order.agent.email,
        subject: rendered.subject,
        photoUrl,
        hasPersonalNote: !!body.personalNote?.trim(),
        resendId: result.id,
      },
    },
  })

  return NextResponse.json({
    ok: true,
    sentToEmail: to,
    resendId: result.id,
  })
}
