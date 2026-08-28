/**
 * GET  /api/outreach/campaigns — recent campaigns + their outcomes.
 * POST /api/outreach/campaigns — create a DRAFT and snapshot its audience.
 *
 * POST is the moment the audience stops moving. It resolves the segment
 * once, renders each recipient's copy, and writes a row per person —
 * including the ones it cannot personalise, marked SKIPPED with a reason.
 * Recording the skips rather than dropping them is what lets a rep see
 * "412 ready, 38 skipped because they have no company on file" instead of
 * wondering where 38 people went.
 *
 * Creating a draft sends nothing. Release is a separate, explicit call.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { resolveRecipients } from '@/lib/outreach/campaign'
import { renderForRecipient } from '@/lib/outreach/mergeFields'

export const dynamic = 'force-dynamic'

const MAX_AUDIENCE = 2000

export async function GET() {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const campaigns = await prisma.outreachCampaign.findMany({
    select: {
      id: true, name: true, subject: true, status: true,
      createdAt: true, releasedAt: true, completedAt: true,
      createdBy: { select: { name: true, email: true } },
      _count: { select: { recipients: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 40,
  })

  const counts = await prisma.outreachCampaignRecipient.groupBy({
    by: ['campaignId', 'status'],
    where: { campaignId: { in: campaigns.map((c) => c.id) } },
    _count: { _all: true },
  })
  const byCampaign = new Map<string, Record<string, number>>()
  for (const row of counts) {
    const bucket = byCampaign.get(row.campaignId) ?? {}
    bucket[row.status] = row._count._all
    byCampaign.set(row.campaignId, bucket)
  }

  return NextResponse.json({
    campaigns: campaigns.map((c) => ({ ...c, statusCounts: byCampaign.get(c.id) ?? {} })),
  })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true, email: true },
  })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as {
    name?: string
    subject?: string
    bodyTemplate?: string
    segmentKey?: string | null
    roleKey?: string | null
    search?: string | null
    savedSegmentId?: string | null
    replyTo?: string | null
  } | null
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 })

  const name = (body.name ?? '').trim()
  const subject = (body.subject ?? '').trim()
  const template = (body.bodyTemplate ?? '').trim()
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (!subject) return NextResponse.json({ error: 'subject required' }, { status: 400 })
  if (!template) return NextResponse.json({ error: 'body required' }, { status: 400 })

  const { recipients } = await resolveRecipients(
    { segmentKey: body.segmentKey, roleKey: body.roleKey, search: body.search },
    user.id,
    user.name ?? null,
  )
  if (recipients.length === 0) {
    return NextResponse.json(
      { error: 'That segment resolves to nobody sendable right now.' },
      { status: 400 },
    )
  }
  if (recipients.length > MAX_AUDIENCE) {
    return NextResponse.json(
      {
        error: `That segment is ${recipients.length} contacts. A single campaign is capped at ${MAX_AUDIENCE} — narrow it, or split it across days.`,
      },
      { status: 400 },
    )
  }

  const campaign = await prisma.outreachCampaign.create({
    data: {
      name,
      subject,
      bodyTemplate: template,
      segmentKey: body.segmentKey ?? null,
      roleKey: body.roleKey ?? null,
      search: body.search ?? null,
      savedSegmentId: body.savedSegmentId ?? null,
      // The rep's own address, per Wes's ruling that outreach comes from
      // a person. The DOMAIN is enforced by sendGuard at release, not
      // here — a draft may be composed before the subdomain exists.
      fromName: user.name ?? null,
      fromAddress: user.email,
      replyTo: body.replyTo ?? user.email,
      createdById: user.id,
    },
    select: { id: true },
  })

  await prisma.outreachCampaignRecipient.createMany({
    data: recipients.map((r) => {
      const rendered = renderForRecipient(subject, template, r.ctx)
      return {
        campaignId: campaign.id,
        personId: r.personId,
        email: r.email,
        status: rendered.ok ? ('PENDING' as const) : ('SKIPPED' as const),
        reason: rendered.ok
          ? null
          : `No value for ${rendered.missing.join(', ')} on this contact`,
        renderedSubject: rendered.ok ? rendered.subject : null,
        renderedBody: rendered.ok ? rendered.body : null,
      }
    }),
    skipDuplicates: true,
  })

  const statusCounts = await prisma.outreachCampaignRecipient.groupBy({
    by: ['status'],
    where: { campaignId: campaign.id },
    _count: { _all: true },
  })

  return NextResponse.json(
    {
      id: campaign.id,
      statusCounts: Object.fromEntries(statusCounts.map((s) => [s.status, s._count._all])),
    },
    { status: 201 },
  )
}
