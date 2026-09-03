/**
 * /api/jobs/[id]/after-hours — the staff side of the after-hours release.
 *
 *   GET    → what the client would see, plus who the email would go to and
 *            whether the codes are even on file. Read this before sending.
 *   POST   → { action: 'send' | 'release' | 'revoke', personId?, note? }
 *
 * GET returns the ACCESS CODES to staff. That is not a widening: they are
 * the same codes /admin/assistant already shows, and an agent reading them
 * to a client on the phone is the whole reason "release without email"
 * exists. Staff session required, like every other job route.
 *
 * Wes 2026-09-02: replaces attaching "Afer Hours EQ P:R.pdf" by hand.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { afterHoursPayload } from '@/lib/afterHours/instructions'
import {
  sendAfterHoursAccess,
  releaseAfterHours,
  revokeAfterHours,
} from '@/lib/afterHours/sendAfterHoursAccess'
import { shareAfterHours } from '@/lib/afterHours/share'
import { pickPrimaryContact } from '@/lib/jobs/primaryContact'

export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id || null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const job = await prisma.job.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      afterHoursReleasedAt: true,
      afterHoursSentAt: true,
      afterHoursSentTo: true,
      afterHoursNote: true,
      afterHoursReleasedById: true,
      orders: { select: { portalSlug: true } },
      jobContacts: {
        select: {
          role: true,
          isPrimary: true,
          person: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      },
    },
  })
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 })

  const payload = await afterHoursPayload()
  const mailable = job.jobContacts.filter((c) => EMAIL_RE.test(c.person.email || ''))
  const to = pickPrimaryContact(mailable)

  // Plain lookup rather than a relation: afterHoursReleasedById is a bare
  // column so the Job model doesn't grow a fifth User back-relation for a
  // name shown on one line of one card. Same shape /admin/assistant uses
  // for gateCodeUpdatedById.
  const releasedBy = job.afterHoursReleasedById
    ? await prisma.user.findUnique({
        where: { id: job.afterHoursReleasedById },
        select: { name: true, email: true },
      })
    : null

  return NextResponse.json({
    releasedAt: job.afterHoursReleasedAt,
    releasedBy: releasedBy?.name || releasedBy?.email || null,
    sentAt: job.afterHoursSentAt,
    sentTo: job.afterHoursSentTo,
    note: job.afterHoursNote,
    // Nothing to link to without a portal slug — say so here rather than
    // letting the agent find out by pressing Send.
    hasPortalOrder: job.orders.some((o) => !!o.portalSlug),
    recipient: to
      ? {
          personId: to.person.id,
          name: [to.person.firstName, to.person.lastName]
            .filter((s) => s && s !== '—')
            .join(' ')
            .trim(),
          email: to.person.email,
          role: to.role,
        }
      : null,
    // Narrow driver links minted off this job, by the client or by us. The
    // agent needs to see them: "did the driver ever open it" is the first
    // question when a truck is sitting outside a gate at 5am.
    shares: (
      await prisma.afterHoursShare.findMany({
        where: { jobId: job.id, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true, email: true, name: true, createdAt: true,
          expiresAt: true, viewedAt: true, sharedByUserId: true,
        },
      })
    ).map((s) => ({ ...s, by: s.sharedByUserId ? 'staff' : 'client' })),
    contacts: mailable.map((c) => ({
      personId: c.person.id,
      name: [c.person.firstName, c.person.lastName]
        .filter((s) => s && s !== '—')
        .join(' ')
        .trim(),
      email: c.person.email,
      role: c.role,
    })),
    instructions: payload,
  })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id || null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    action?: string
    personId?: string
    note?: string
    email?: string
    name?: string
    message?: string
  }
  const action = body.action || 'send'
  const note = typeof body.note === 'string' ? body.note.slice(0, 2000) : undefined

  // Staff-side forward — the same narrow driver link the client can mint
  // from their portal, for when the coordinator asks us to send it directly.
  // Deliberately shares the lib rather than a second path: a driver link
  // that behaved differently depending on who pressed the button is a
  // security surface nobody would think to check twice.
  if (action === 'share') {
    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    })
    const result = await shareAfterHours({
      jobId: params.id,
      email: body.email || '',
      recipientName: body.name?.slice(0, 120) || null,
      message: body.message?.slice(0, 1000) || null,
      senderName: me?.name || 'SirReel',
      sharedByUserId: userId,
    })
    if (!result.ok) {
      const status =
        result.reason === 'bad_email' ? 400 : result.reason === 'send_failed' ? 502 : 409
      return NextResponse.json({ error: result.message }, { status })
    }
    return NextResponse.json({ ok: true, sentTo: result.email })
  }

  if (action === 'revoke') {
    await revokeAfterHours({ jobId: params.id, userId })
    return NextResponse.json({ ok: true, releasedAt: null })
  }

  if (action === 'release') {
    await releaseAfterHours({ jobId: params.id, userId, note })
    const j = await prisma.job.findUnique({
      where: { id: params.id },
      select: { afterHoursReleasedAt: true, afterHoursNote: true },
    })
    return NextResponse.json({
      ok: true,
      releasedAt: j?.afterHoursReleasedAt ?? null,
      note: j?.afterHoursNote ?? null,
    })
  }

  if (action !== 'send') {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  }

  // Refuse to send a page that would render "Gate code: —". A driver at
  // 5am reads a missing code as "there is no code", drives to Sun Valley,
  // and calls the 24/7 line from outside a locked gate.
  const instructions = await afterHoursPayload()
  if (!instructions.complete) {
    const missing = [
      !instructions.gateCode ? 'the gate code' : null,
      !instructions.containerCode ? 'the storage container code' : null,
    ]
      .filter(Boolean)
      .join(' and ')
    return NextResponse.json(
      {
        error: `${missing} is not on file, so the page would tell your client there isn't one. Record it under Admin → Assistant first.`,
      },
      { status: 409 },
    )
  }

  const result = await sendAfterHoursAccess({
    jobId: params.id,
    userId,
    personId: body.personId || null,
    note,
  })
  if (!result.ok) {
    const status =
      result.reason === 'job_not_found'
        ? 404
        : result.reason === 'send_failed'
          ? 502
          : 409
    return NextResponse.json({ error: result.message }, { status })
  }

  const j = await prisma.job.findUnique({
    where: { id: params.id },
    select: { afterHoursReleasedAt: true, afterHoursSentAt: true, afterHoursNote: true },
  })
  return NextResponse.json({
    ok: true,
    sentTo: result.sentTo,
    contactName: result.contactName,
    releasedAt: j?.afterHoursReleasedAt ?? null,
    sentAt: j?.afterHoursSentAt ?? null,
    note: j?.afterHoursNote ?? null,
  })
}
