import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { issueJobMagicLink } from '@/lib/portal/jobMagicLink'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { recordEmailDelivery } from '@/lib/email/recordEmailDelivery'
import { buildPortalInviteEmail } from '@/lib/email/templates/portalInvite'

export const dynamic = 'force-dynamic'

/**
 * POST /api/orders/[id]/portal-access/invite
 *
 * Rep-side direct invite. Body:
 *   { email: string, firstName?: string, lastName?: string }
 *
 * Find-or-creates a Person by email, mints a PortalAccess + 7-day magic-link
 * token, and emails the magic link directly to the contact. Returns the
 * portal URL so the rep can copy it if email delivery is unverified (Resend
 * domain status is what makes this best-effort today).
 *
 * `regenerate` behavior from /portal-access POST is separate — that endpoint
 * is for "regenerate the existing access for a known contact". This endpoint
 * is for "I have an email address, set them up from scratch."
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sessionUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true },
  })
  if (!sessionUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    email?: unknown
    firstName?: unknown
    lastName?: unknown
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : ''
  const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      portalSlug: true,
      job: { select: { name: true, jobCode: true } },
      company: { select: { name: true } },
      agent: { select: { name: true, email: true, phone: true } },
    },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (!order.portalSlug) {
    return NextResponse.json({ error: 'Order has no portal slug' }, { status: 409 })
  }

  // Find-or-create Person. Email is unique on the model, so upsert by email.
  const person = await prisma.person.upsert({
    where: { email },
    create: {
      email,
      firstName: firstName || email.split('@')[0],
      lastName: lastName || '—',
    },
    update:
      firstName || lastName
        ? {
            firstName: firstName || undefined,
            lastName: lastName || undefined,
          }
        : {},
    select: { id: true, firstName: true, lastName: true, email: true },
  })

  const issued = await issueJobMagicLink({ orderId: order.id, contactId: person.id })
  const portalUrl = `https://hq.sirreel.com/portal/job/${order.portalSlug}?token=${encodeURIComponent(issued.token)}`

  const jobLabel = order.job?.name || order.company?.name || ''
  const tpl = buildPortalInviteEmail({
    firstName: person.firstName,
    projectName: jobLabel,
    portalLink: portalUrl,
    repName: order.agent?.name || 'the SirReel team',
    repPhone: order.agent?.phone || null,
    repEmail: order.agent?.email || null,
  })
  const emailResult = await sendAgreementEmail({
    label: 'portal/invite',
    to: [person.email],
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
  })
  if (emailResult.ok && emailResult.id) {
    await recordEmailDelivery({
      resendMessageId: emailResult.id,
      toAddress: person.email,
      subject: tpl.subject,
      label: 'portal/invite',
      orderId: order.id,
    })
  }

  return NextResponse.json({
    ok: true,
    portalUrl,
    person,
    portalAccessId: issued.portalAccessId,
    emailResult,
  })
}
