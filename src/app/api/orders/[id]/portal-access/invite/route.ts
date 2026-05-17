import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { issueJobMagicLink } from '@/lib/portal/jobMagicLink'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'

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

  // Best-effort send. Mirrors sendAgreementEmail's failure-surfacing contract
  // so the rep sees Resend errors rather than a silent no-op.
  const fromRep = order.agent
    ? `${order.agent.name} <${order.agent.email}>`
    : 'SirReel HQ <notifications@sirreel.com>'
  const jobLabel = order.job?.name || order.company?.name || ''
  const repName = order.agent?.name || 'the SirReel team'
  const repPhone = order.agent?.phone || ''
  const html = `<!DOCTYPE html>
<html><body style="font-family:Helvetica,Arial,sans-serif;background:#f9fafb;margin:0;padding:24px;color:#111827;">
  <div style="max-width:560px;margin:0 auto;background:white;border-radius:8px;padding:24px;font-size:14px;line-height:1.55;">
    <p>Hi ${person.firstName},</p>
    <p>Here&rsquo;s your portal access for <strong>${jobLabel}</strong>. You can see paperwork, the schedule, equipment, and the pickup details all in one place.</p>
    <p style="margin:20px 0;text-align:center;">
      <a href="${portalUrl}" style="display:inline-block;background:#1f3d5c;color:white;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:600;">Open your project portal &rarr;</a>
    </p>
    <p style="font-size:12px;color:#6b7280;">Link is good for 7 days. If it expires, just reply to this email and I&rsquo;ll send a fresh one.</p>
    <p>Best,<br>${repName}${repPhone ? `<br>${repPhone}` : ''}</p>
  </div>
</body></html>`

  const emailResult = await sendAgreementEmail({
    label: 'portal/invite',
    to: [person.email],
    subject: `Your SirReel portal for ${jobLabel}`,
    html,
  })
  // sendAgreementEmail hardcodes from=SirReel HQ — we use it because the
  // rep's domain may not be DKIM-verified yet. When per-rep send is healthy,
  // swap to a custom call that uses `fromRep`. (See CRH brief §10 "from per rep".)
  void fromRep

  return NextResponse.json({
    ok: true,
    portalUrl,
    person,
    portalAccessId: issued.portalAccessId,
    emailResult,
  })
}
