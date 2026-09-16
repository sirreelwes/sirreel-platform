/**
 * POST /api/orders/[id]/thank-you/preview
 *
 * Renders the thank-you email payload WITHOUT sending — same shape
 * the existing send-quote/preview returns. Drives the in-page
 * preview iframe on the compose view. Mirror of the quote-send
 * preview/send pattern: same renderer in preview + send so the rep
 * sees exactly what lands.
 *
 * Body:
 *   { personalNote?, photoCaption?, photoDocumentId?, photoSource? }
 *
 * photoSource ('weekly' | 'order' | 'none') NAMES the picture; the server
 * resolves it (src/lib/orders/thankYouPhoto.ts). It replaces the old
 * photoUrlOverride, which let the browser hand us a raw private blob URL
 * that 403'd in the client's inbox — see that file's header.
 *
 * Returns:
 *   { to, from, replyTo, subject, html, text, photoUrl }
 *
 * Auth: getServerSession.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { SEND_FROM } from '@/lib/email/sendAgreementEmail'
import { buildThankYouEmail } from '@/lib/email/templates/thankYouTemplate'
import { parsePhotoSource, resolveThankYouPhoto } from '@/lib/orders/thankYouPhoto'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const body = await req.json().catch(() => ({})) as {
    personalNote?: string | null
    photoDocumentId?: string | null
    photoCaption?: string | null
    /** When set, render with the agent's weekly candid URL directly
     *  (skips the OrderDocument lookup). */
    photoSource?: string | null
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
    },
  })
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })
  if (!order.agent) return NextResponse.json({ error: 'order has no agent' }, { status: 422 })

  // Both photo sources are PRIVATE blobs, so the preview and the mail both
  // carry a public proxy URL — never a raw blob URL, which 403s in an inbox.
  // Same resolver as the send route, so the iframe the rep approves is the
  // mail the client gets.
  const suggestion = await prisma.thankYouSuggestion.findUnique({
    where: { orderId: id },
    select: { photoDocumentId: true },
  })
  const { photoUrl } = await resolveThankYouPhoto({
    orderId: id,
    agentId: order.agent.id,
    source: parsePhotoSource(body.photoSource),
    photoDocumentId: body.photoDocumentId,
    pinnedDocumentId: suggestion?.photoDocumentId,
  })

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

  return NextResponse.json({
    to: order.jobContact?.email ?? null,
    from: SEND_FROM,
    replyTo: order.agent.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    photoUrl,
  })
}
