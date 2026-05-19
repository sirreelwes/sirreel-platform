import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildBookingWelcomeEmail } from '@/lib/email/templates/bookingWelcome'

export const dynamic = 'force-dynamic'

/**
 * POST /api/bookings/[id]/send-welcome
 *
 * Sends the TSX-branded "Let's get started" booking welcome email to
 * the booking's primary contact. Triggered from the Create & Send
 * Portal Link success modal — replaces the old mailto: flow, which
 * couldn't carry HTML styling.
 *
 * From header: "{repName} <notifications@sirreel.com>" so the bot
 * sends from the verified shared domain (DKIM/SPF aligned), while the
 * display name signals personal authorship.
 * Reply-To: repEmail (e.g., jose@sirreel.com) routes replies back to
 * the actual rep's inbox.
 *
 * The cadence master switch (CADENCE_SENDING_ENABLED) does NOT gate
 * this endpoint — that flag controls the automated cadence runner.
 * The welcome email is a manual rep-initiated send and must work even
 * when cadence is paused. RESEND_API_KEY missing → returns 503 so the
 * UI can show a useful error.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const booking = await prisma.booking.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      bookingNumber: true,
      jobName: true,
      productionName: true,
      agent: { select: { name: true, email: true, phone: true } },
      person: { select: { firstName: true, lastName: true, email: true } },
      company: { select: { name: true } },
    },
  })
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

  if (!booking.person?.email) {
    return NextResponse.json({ error: 'Booking has no contact email on file' }, { status: 409 })
  }

  // Resolve the portal magic-link the same way send-portal does. If
  // none exists yet, fall back to the canonical /portal/job/<slug>
  // route — but that requires a slug we don't have here, so just send
  // the paperwork-portal token URL.
  const paperwork = await prisma.paperworkRequest.findFirst({
    where: { bookingId: booking.id },
    orderBy: { sentAt: 'desc' },
    select: { token: true },
  })
  if (!paperwork) {
    return NextResponse.json(
      { error: 'No paperwork-portal token has been generated for this booking yet' },
      { status: 409 },
    )
  }
  const portalLink = `${process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com'}/portal/${paperwork.token}`

  const projectName = booking.productionName || booking.jobName || booking.company?.name || 'your project'

  const tpl = buildBookingWelcomeEmail({
    firstName: booking.person.firstName || 'there',
    projectName,
    portalLink,
    repName: booking.agent?.name || 'the SirReel team',
    repPhone: booking.agent?.phone || null,
    repEmail: booking.agent?.email || null,
  })

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'RESEND_API_KEY not set' }, { status: 503 })
  }
  const fromName = booking.agent?.name || 'SirReel Studio Services'
  const from = `${fromName} <notifications@sirreel.com>`
  const replyTo = booking.agent?.email || undefined

  const resend = new Resend(process.env.RESEND_API_KEY)
  try {
    const result = await resend.emails.send({
      from,
      to: [booking.person.email],
      replyTo,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    })
    const err = (result as { error?: { message?: string } })?.error
    if (err) {
      const reason = err.message || JSON.stringify(err)
      return NextResponse.json({ error: reason }, { status: 502 })
    }
    return NextResponse.json({
      ok: true,
      id: (result as { data?: { id?: string } })?.data?.id ?? null,
      to: booking.person.email,
      from,
      replyTo,
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: reason }, { status: 502 })
  }
}
