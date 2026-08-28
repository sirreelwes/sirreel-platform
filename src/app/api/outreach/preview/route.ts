/**
 * POST /api/outreach/preview — resolve a segment and render real samples.
 *
 * Answers the three questions a rep needs before releasing anything:
 * how many people will this reach, how many of them can the copy
 * actually be personalised for, and what does it look like for a real
 * contact rather than an idealised one.
 *
 * Sends nothing. Writes nothing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { resolveRecipients, buildPreview, countUnrenderable } from '@/lib/outreach/campaign'
import { tokensUsed } from '@/lib/outreach/mergeFields'
import { sendGuard } from '@/lib/outreach/sendGuard'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true, email: true },
  })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as {
    segmentKey?: string | null
    roleKey?: string | null
    search?: string | null
    subject?: string
    bodyTemplate?: string
  } | null
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 })

  const subject = (body.subject ?? '').trim()
  const template = (body.bodyTemplate ?? '').trim()

  const { recipients, suppressedCount, totalBeforeSuppression } = await resolveRecipients(
    { segmentKey: body.segmentKey, roleKey: body.roleKey, search: body.search },
    user.id,
    user.name ?? null,
  )

  // Authoring mistakes are worth reporting even with no copy yet.
  const used = tokensUsed(`${subject}\n${template}`)

  const previews = subject && template ? buildPreview(subject, template, recipients) : []
  const { unrenderable, byToken } =
    subject && template
      ? countUnrenderable(subject, template, recipients)
      : { unrenderable: 0, byToken: {} }

  // Report the guard's verdict WITHOUT sending, so the composer can tell
  // the rep up front that sending is switched off rather than letting
  // them write a campaign and hit a wall at release.
  const guard = await sendGuard({
    userId: user.id,
    fromAddress: `${user.email}`,
    recipients: recipients.slice(0, 1).map((r) => r.email),
  })

  return NextResponse.json({
    audience: {
      total: totalBeforeSuppression,
      suppressed: suppressedCount,
      sendable: recipients.length,
      unrenderable,
      unrenderableByToken: byToken,
      readyToSend: Math.max(0, recipients.length - unrenderable),
    },
    unknownTokens: used.unknown,
    previews,
    sending: {
      allowed: guard.allowed,
      reason: guard.reason ?? null,
      message: guard.message ?? null,
      remainingPerRep: guard.remainingPerRep,
      remainingGlobal: guard.remainingGlobal,
    },
  })
}
