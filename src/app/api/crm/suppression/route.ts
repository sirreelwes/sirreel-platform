/**
 * Staff suppression controls.
 *
 *   GET    /api/crm/suppression?email=  — current state for one address
 *   POST   /api/crm/suppression         — suppress by hand
 *   DELETE /api/crm/suppression         — release (attributed)
 *
 * Staff need this because opt-outs arrive by every channel except the
 * unsubscribe link: a producer says "take me off that list" on a call, a
 * rep gets a reply saying stop. Recording it here means the next campaign
 * honours it automatically instead of relying on someone remembering.
 *
 * Releasing is deliberately separate, attributed, and never bulk. Letting
 * an address back in is a decision with legal weight, and it should read
 * like one.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { SuppressionReason } from '@prisma/client'
import {
  suppressEmail,
  releaseSuppression,
  normalizeSuppressionEmail,
} from '@/lib/outreach/suppression'

export const dynamic = 'force-dynamic'

async function requireUser() {
  const session = await getServerSession()
  if (!session?.user?.email) return null
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true },
  })
  return user
}

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = new URL(req.url).searchParams.get('email')
  if (!raw) return NextResponse.json({ error: 'email required' }, { status: 400 })

  const row = await prisma.emailSuppression.findUnique({
    where: { email: normalizeSuppressionEmail(raw) },
    select: {
      id: true, email: true, reason: true, detail: true, source: true,
      suppressedAt: true, releasedAt: true, releaseNote: true,
      releasedBy: { select: { name: true, email: true } },
    },
  })
  // active = suppressed and not released. A released row is still
  // returned so the UI can show "released by Ana on the 3rd".
  return NextResponse.json({ suppression: row, active: !!row && row.releasedAt === null })
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as {
    email?: unknown
    reason?: unknown
    detail?: unknown
  } | null
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  // Staff may only record the two reasons a human can actually observe.
  // BOUNCED and COMPLAINED belong to the provider webhook — letting a
  // person set those by hand would put unearned blame on an address and
  // corrupt the deliverability picture.
  const reasonRaw = typeof body?.reason === 'string' ? body.reason : 'UNSUBSCRIBED'
  if (reasonRaw !== 'UNSUBSCRIBED' && reasonRaw !== 'MANUAL') {
    return NextResponse.json(
      { error: 'Staff may record UNSUBSCRIBED or MANUAL. Bounces and complaints come from the mail provider.' },
      { status: 400 },
    )
  }

  const person = await prisma.person.findUnique({
    where: { email: normalizeSuppressionEmail(email) },
    select: { id: true },
  })

  const result = await suppressEmail({
    email,
    reason: reasonRaw as SuppressionReason,
    detail: typeof body?.detail === 'string' && body.detail.trim() ? body.detail.trim() : null,
    source: `staff:${user.email}`,
    personId: person?.id ?? null,
  })
  return NextResponse.json({ ok: true, ...result })
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { email?: unknown; note?: unknown } | null
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  const existing = await prisma.emailSuppression.findUnique({
    where: { email: normalizeSuppressionEmail(email) },
    select: { reason: true, releasedAt: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not suppressed' }, { status: 404 })
  if (existing.releasedAt) return NextResponse.json({ ok: true, alreadyReleased: true })

  // A complaint is the one thing a rep should not be able to wave away
  // on their own. Someone told their mail provider we were spam; mailing
  // them again risks the domain everyone's contracts travel on.
  if (existing.reason === 'COMPLAINED') {
    return NextResponse.json(
      {
        error:
          'This address reported us as spam. Releasing it risks the sending domain — that call belongs to Wes, not to a per-contact toggle.',
      },
      { status: 403 },
    )
  }

  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null
  const released = await releaseSuppression({ email, releasedById: user.id, note })
  return NextResponse.json({ ok: released })
}
