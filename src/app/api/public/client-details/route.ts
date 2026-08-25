import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyDetailsToken } from '@/lib/intake/detailsToken'

export const dynamic = 'force-dynamic'

/** One line of typed text, not an essay — matches the email's "quick thing". */
const MAX_LEN = 160

function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().replace(/\s+/g, ' ')
  if (!t) return null
  return t.slice(0, MAX_LEN)
}

/**
 * POST /api/public/client-details — UNAUTHENTICATED. The client's answer to
 * "what's the production company and project name?", typed on
 * /details/<token>.
 *
 * Authorization is the signed token alone (same envelope as the COI drop
 * link). What that buys us is bounded on purpose: the token names the
 * inquiry/booking and the address we mailed, and NOTHING the caller sends
 * can change either — `sentToEmail` is stamped from the payload, never
 * from the body. So the worst a leaked link can do is attach a wrong
 * suggestion to one inquiry.
 *
 * It stays a SUGGESTION (Wes, 2026-08-25). This route writes a
 * ClientDetailReply and touches nothing else — no Company is matched or
 * created, no Job, no Booking field. An agent accepts it in HQ, and the
 * accept runs through the normal CompanyPicker / JobResolver so their
 * near-match and find-or-create discipline still applies. A stranger with
 * the link cannot rename a client or spawn CRM rows.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { token?: string; companyName?: string; projectName?: string }
    | null
  if (!body) return NextResponse.json({ ok: false, error: 'invalid request' }, { status: 400 })

  const payload = verifyDetailsToken(body.token)
  if (!payload) {
    return NextResponse.json(
      { ok: false, error: 'This link has expired. Please reply to our email instead.' },
      { status: 401 },
    )
  }

  const companyName = clean(body.companyName)
  const projectName = clean(body.projectName)
  if (!companyName && !projectName) {
    return NextResponse.json({ ok: false, error: 'Please fill in at least one field.' }, { status: 400 })
  }

  // Confirm the target still exists — an inquiry can be deleted between the
  // send and the click, and a dangling FK would 500 in the client's face.
  if (payload.inquiryId) {
    const inquiry = await prisma.inquiry.findUnique({ where: { id: payload.inquiryId }, select: { id: true } })
    if (!inquiry) {
      return NextResponse.json(
        { ok: false, error: 'This booking is no longer open. Please reply to our email instead.' },
        { status: 404 },
      )
    }
  } else if (payload.bookingId) {
    const booking = await prisma.booking.findUnique({ where: { id: payload.bookingId }, select: { id: true } })
    if (!booking) {
      return NextResponse.json(
        { ok: false, error: 'This booking is no longer open. Please reply to our email instead.' },
        { status: 404 },
      )
    }
  }

  // A forwarded link shouldn't stack duplicates. If an unresolved reply is
  // already on this target, UPDATE it — the newest answer wins and the
  // agent still sees exactly one card to accept.
  const existing = await prisma.clientDetailReply.findFirst({
    where: {
      status: 'PENDING',
      ...(payload.inquiryId ? { inquiryId: payload.inquiryId } : { bookingId: payload.bookingId }),
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })

  const data = {
    companyName,
    projectName,
    // From the SIGNED payload — a submitter cannot claim another sender.
    sentToEmail: payload.sentTo ?? null,
  }

  const reply = existing
    ? await prisma.clientDetailReply.update({ where: { id: existing.id }, data, select: { id: true } })
    : await prisma.clientDetailReply.create({
        data: {
          ...data,
          inquiryId: payload.inquiryId ?? null,
          bookingId: payload.bookingId ?? null,
        },
        select: { id: true },
      })

  return NextResponse.json({ ok: true, id: reply.id })
}
