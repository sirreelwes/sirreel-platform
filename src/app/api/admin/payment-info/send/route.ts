/**
 * /api/admin/payment-info/send — email SirReel's payment details to an
 * address the operator types in, with a free-text note saying who it is.
 *
 * Wes 2026-09-15: "is there a Send Payment Info anywhere that simply allows
 * us to enter an email address … sometimes they are old jobs so better to
 * just have a note." The two existing senders both hang off a record — the
 * payment-info INQUIRY panel (hidden once the inquiry is closed) and an HQ
 * invoice's "Send payment options" (the order's own contact only). Maddy
 * (maddy@contrast.tv) asked through the public form that morning, had no
 * qualifying job, and her inquiry was dismissed within five minutes — at
 * which point nothing in HQ could send to her.
 *
 * The typed address is the risk this surface accepts. Senders are ADMIN,
 * MANAGER, BILLING and AGENT (sales) — Wes, same day: "let sales send it
 * too". That is wider than READING the numbers on /admin/payment-info
 * (ADMIN + BILLING) on purpose: sending puts the details in the client's
 * inbox, not on a staff screen. Every send gets the same branded email + verify link + fraud line as every other
 * send (sendPaymentDetailsEmail), and an audit row per send carrying the
 * address, the note and the sender — NEVER the details.
 *
 * GET  → the recent direct sends, for the list under the form.
 * POST → { email, firstName?, note? } sends.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-admin'
import { normalizeEmail, resolvePersonByEmail } from '@/lib/people/email'
import { sendPaymentDetailsEmail } from '@/lib/payments/sendPaymentDetails'

export const dynamic = 'force-dynamic'

const ACTION = 'payment_details.sent_direct'
const NOTE_MAX = 500

const SENDER_ROLES = new Set(['ADMIN', 'MANAGER', 'BILLING', 'AGENT'])

async function requireSender() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (!SENDER_ROLES.has(user.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  return { user }
}

const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)

export async function GET() {
  const gate = await requireSender()
  if (gate instanceof NextResponse) return gate

  const rows = await prisma.auditLog.findMany({
    where: { action: ACTION },
    orderBy: { createdAt: 'desc' },
    take: 15,
    select: { id: true, userId: true, newValues: true, createdAt: true },
  })
  const userIds = Array.from(new Set(rows.map((r) => r.userId).filter((x): x is string => !!x)))
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
    : []
  const nameOf = new Map(users.map((u) => [u.id, u.name || u.email]))

  return NextResponse.json({
    sends: rows.map((r) => {
      const v = (r.newValues ?? {}) as Record<string, unknown>
      return {
        id: r.id,
        sentTo: typeof v.sentTo === 'string' ? v.sentTo : '',
        note: typeof v.note === 'string' ? v.note : null,
        sentBy: r.userId ? nameOf.get(r.userId) ?? null : null,
        at: r.createdAt.toISOString(),
      }
    }),
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireSender()
  if (gate instanceof NextResponse) return gate
  const { user } = gate

  const body = (await req.json().catch(() => ({}))) as { email?: unknown; firstName?: unknown; note?: unknown }
  const email = normalizeEmail(typeof body.email === 'string' ? body.email : '')
  if (!validEmail(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, NOTE_MAX) : ''
  const typedName = typeof body.firstName === 'string' ? body.firstName.trim() : ''

  // A typed first name wins; otherwise use the contact on file, if any, so
  // "Hi Maddy," still reads right for someone HQ already knows.
  const person = (await resolvePersonByEmail(email, { select: { id: true, firstName: true } })) as
    | { id: string; firstName: string | null }
    | null
  const firstName = typedName || person?.firstName || null

  const result = await sendPaymentDetailsEmail({ to: email, firstName })
  if (!result.ok) {
    return NextResponse.json(
      {
        error:
          result.reason === 'not_configured'
            ? 'Payment details are not set up yet — Wes fills them in under Admin → Payment Info.'
            : 'Could not send the payment details. Please try again.',
      },
      { status: result.reason === 'not_configured' ? 409 : 502 },
    )
  }

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: ACTION,
      entityType: 'PaymentDetails',
      entityId: email,
      newValues: {
        sentTo: email,
        note: note || null,
        firstName,
        personId: person?.id ?? null,
        attachmentsSent: result.attachmentsSent,
        attachmentsDropped: result.dropped.length,
      },
    },
  })

  return NextResponse.json({ ok: true, sentTo: email, dropped: result.dropped })
}
