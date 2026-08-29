/**
 * POST /api/portal/job/coi-requirements
 *
 * The client sends our insurance requirements straight to their broker from
 * their own job page, instead of us emailing the client so the client can
 * forward it. One less hop, and the broker gets the wording intact.
 *
 * ── Not a mail relay ────────────────────────────────────────────────────────
 * The ONLY thing this takes from the browser is the broker's email address.
 * Subject and body are composed server-side from COI_REQUIREMENTS; there is
 * no free-text field, so a portal session cannot be used to send arbitrary
 * content to arbitrary people. Everything identifying (client name, company,
 * job, dates) comes from the session, never the request.
 *
 * Reply-To is the CLIENT, and the client is CC'd. The broker is answering
 * their own customer, not us, and the customer keeps the paper trail. We
 * still name where the certificate should land, so the reply can come
 * straight to us if the broker prefers.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { JOB_SESSION_COOKIE, verifyJobSessionCookieValue } from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { PUBLIC_SITE_ORIGIN } from '@/lib/site/publicUrl'
import {
  AUTO_PHYSICAL_DAMAGE_NOTE,
  CERTIFICATE_HOLDER,
  requirementsAsHtml,
  requirementsAsText,
} from '@/lib/coi/requirements'

export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const COI_INBOX = 'hello@sirreel.com'

const INK = '#1a1a1a'
const MUTED = '#6b7280'
const ACCENT = '#b45309'

export async function POST(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) return NextResponse.json({ error: 'No session' }, { status: 401 })
  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) return NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const to = typeof body.to === 'string' ? body.to.trim() : ''
  if (!EMAIL_RE.test(to)) {
    return NextResponse.json({ error: 'Enter a valid email address for your broker.' }, { status: 400 })
  }

  const order = await prisma.order.findUnique({
    where: { id: resolved.orderId },
    select: {
      orderNumber: true,
      startDate: true,
      endDate: true,
      company: { select: { name: true } },
      job: { select: { name: true } },
    },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const clientName = resolved.contact
    ? `${resolved.contact.firstName ?? ''} ${resolved.contact.lastName ?? ''}`.trim()
    : null
  const clientEmail = resolved.contact?.email ?? null
  const company = order.company?.name ?? 'our client'
  const sampleUrl = `${PUBLIC_SITE_ORIGIN}/api/public/forms/coi`

  const fmt = (d: Date | null) =>
    d ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null
  const dates =
    order.startDate && order.endDate
      ? fmt(order.startDate) === fmt(order.endDate)
        ? fmt(order.startDate)
        : `${fmt(order.startDate)} – ${fmt(order.endDate)}`
      : null

  const subject = `Certificate of insurance for ${company} — SirReel rental${dates ? ` (${dates})` : ''}`

  const intro =
    `${clientName || company} is renting production vehicles and equipment from SirReel` +
    `${dates ? ` for ${dates}` : ''}, and has asked us to send you the certificate requirements directly.`

  const text = [
    'Hello,',
    '',
    intro,
    '',
    requirementsAsText(),
    '',
    AUTO_PHYSICAL_DAMAGE_NOTE,
    '',
    `A sample certificate showing the format we need: ${sampleUrl}`,
    '',
    `Please send the completed certificate to ${COI_INBOX}` +
      (clientEmail ? `, copying ${clientEmail}.` : '.'),
    '',
    'Thank you,',
    'SirReel Studio Services',
    '8500 Lankershim Blvd, Sun Valley, CA 91352 · (888) 477-7335',
  ].join('\n')

  const html = `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: ${INK}; max-width: 600px; margin: 0 auto; padding: 24px;">
    <p style="font-size: 14px; line-height: 1.6;">Hello,</p>
    <p style="font-size: 14px; line-height: 1.6;">${intro}</p>
    <p style="font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: ${MUTED}; margin: 22px 0 8px;">Insurance requirements (all jobs)</p>
    ${requirementsAsHtml({ textColor: INK, mutedColor: MUTED, accent: ACCENT })}
    <p style="font-size: 13px; line-height: 1.6; color: ${ACCENT}; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 6px; padding: 12px 14px; margin: 18px 0;">
      ${AUTO_PHYSICAL_DAMAGE_NOTE}
    </p>
    <p style="font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: ${MUTED}; margin: 22px 0 6px;">Certificate holder · additional insured · loss payee</p>
    <p style="font-size: 14px; line-height: 1.6; margin: 0;">
      ${CERTIFICATE_HOLDER.name}<br/>${CERTIFICATE_HOLDER.address}
    </p>
    <p style="font-size: 14px; line-height: 1.6; margin: 22px 0 0;">
      <a href="${sampleUrl}" style="color: ${ACCENT}; font-weight: 600;">Download a sample certificate</a>
      showing the format we need.
    </p>
    <p style="font-size: 14px; line-height: 1.6;">
      Please send the completed certificate to <a href="mailto:${COI_INBOX}" style="color: ${ACCENT};">${COI_INBOX}</a>${
        clientEmail ? `, copying <a href="mailto:${clientEmail}" style="color: ${ACCENT};">${clientEmail}</a>.` : '.'
      }
    </p>
    <p style="font-size: 12px; color: ${MUTED}; line-height: 1.6; margin-top: 26px; border-top: 1px solid #ececec; padding-top: 14px;">
      SirReel Studio Services · 8500 Lankershim Blvd, Sun Valley, CA 91352 · (888) 477-7335
    </p>
  </div>`

  const result = await sendAgreementEmail({
    to: [to],
    cc: clientEmail ? [clientEmail] : undefined,
    replyTo: clientEmail ?? undefined,
    subject,
    html,
    text,
    label: `coi-requirements:${order.orderNumber}`,
  })
  if (!result.ok) {
    return NextResponse.json({ error: `Could not send: ${result.reason}` }, { status: 502 })
  }

  await prisma.auditLog.create({
    data: {
      action: 'portal.coi_requirements_sent',
      entityType: 'Order',
      entityId: resolved.orderId,
      userId: null,
      newValues: { to, cc: clientEmail, byPortalContactId: resolved.contact?.id ?? null, resendMessageId: result.id },
    },
  })

  return NextResponse.json({ ok: true, to, cc: clientEmail })
}
