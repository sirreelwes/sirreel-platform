import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { can } from '@/lib/permissions'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { composeSelfServeNextSteps, selfServeEmailLabel } from '@/lib/sales/selfServeNextSteps'

export const dynamic = 'force-dynamic'

/**
 * The "here's what's next" email for a job the client set up themselves.
 *
 *   GET  — compose and return the draft. NEVER sends. This is what the
 *          review modal renders (Wes 2026-09-08: "show me the email
 *          before sending").
 *   POST — send the same draft, CC'd to the sales desk.
 *
 * Two verbs on one route because they must not drift: both call
 * composeSelfServeNextSteps, so the body a rep approves is composed by the
 * same code that dispatches it. The POST recomposes rather than accepting
 * HTML from the browser — a client-supplied body is a mail-injection hole,
 * and it would also let a stale tab send yesterday's paperwork state.
 */

async function actor(): Promise<{ email: string; role: string } | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { email: true, role: true },
  })
  return user ?? null
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const me = await actor()
  if (!me) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const composed = await composeSelfServeNextSteps(params.id)
  if (!composed.ok) return NextResponse.json({ ok: false, error: composed.reason }, { status: 409 })
  return NextResponse.json({ ok: true, draft: composed.draft })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await actor()
  if (!me) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (!can(me.role as Parameters<typeof can>[0], 'canCreateBooking')) {
    return NextResponse.json({ ok: false, error: 'sending client mail is a sales action' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as { confirmResend?: boolean }

  const composed = await composeSelfServeNextSteps(params.id)
  if (!composed.ok) return NextResponse.json({ ok: false, error: composed.reason }, { status: 409 })
  const d = composed.draft

  // Sending twice is not an error, but it should be a decision. The modal
  // shows the earlier send and turns the button into "Send again".
  if (d.alreadySentAt && !body.confirmResend) {
    return NextResponse.json(
      { ok: false, error: 'already sent', alreadySentAt: d.alreadySentAt, code: 'ALREADY_SENT' },
      { status: 409 },
    )
  }

  const res = await sendAgreementEmail({
    to: [d.to],
    cc: d.cc,
    replyTo: d.replyTo ?? undefined,
    subject: d.subject,
    html: d.html,
    text: d.text,
    label: selfServeEmailLabel(d.orderId),
  })
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.reason || 'send failed' }, { status: 502 })
  }

  await prisma.auditLog.create({
    data: {
      userId: null,
      action: 'job.self_serve_next_steps_sent',
      entityType: 'order',
      entityId: d.orderId,
      newValues: {
        jobId: params.id,
        sentBy: me.email,
        to: d.to,
        cc: d.cc,
        subject: d.subject,
        resend: !!d.alreadySentAt,
      },
    },
  }).catch((e) => console.error('[self-serve-email] audit failed', e))

  return NextResponse.json({ ok: true, to: d.to, cc: d.cc, subject: d.subject })
}
