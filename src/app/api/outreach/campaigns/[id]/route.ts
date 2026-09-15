/**
 * GET    /api/outreach/campaigns/[id] — one campaign's saved copy + audience
 *                                       picks, to reopen it in the composer.
 * PATCH  /api/outreach/campaigns/[id] — save changes to a DRAFT.
 * DELETE /api/outreach/campaigns/[id] — discard a DRAFT.
 *
 * Drafts could be saved but never found again (Wes 2026-09-15: "I don't
 * see any way to retrieve that draft") — the list endpoint existed, the
 * composer never read it.
 *
 * Only a DRAFT can be edited or discarded. Once released, the recipient
 * rows are the send audit and must not move.
 *
 * `excludePortalAccess` is not stored on the campaign, so a reopened draft
 * cannot say how it was saved; the composer turns it ON when reopening
 * (the direction that never mails someone a portal they already have).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { resolveRecipients } from '@/lib/outreach/campaign'
import { writeRecipientSnapshot } from '@/lib/outreach/draftSnapshot'

export const dynamic = 'force-dynamic'

// Same cap as POST /api/outreach/campaigns.
const MAX_AUDIENCE = 2000

type Params = { params: Promise<{ id: string }> }

async function currentUser() {
  const session = await getServerSession()
  if (!session?.user?.email) return null
  return prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true, email: true },
  })
}

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const c = await prisma.outreachCampaign.findUnique({
    where: { id },
    select: {
      id: true, name: true, subject: true, bodyTemplate: true, status: true,
      segmentKey: true, roleKey: true, createdAt: true, updatedAt: true,
    },
  })
  if (!c) return NextResponse.json({ error: 'not found' }, { status: 404 })

  return NextResponse.json({
    campaign: {
      ...c,
      roleKeys: c.roleKey ? c.roleKey.split(',').map((r) => r.trim()).filter(Boolean) : [],
    },
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const existing = await prisma.outreachCampaign.findUnique({ where: { id }, select: { id: true, status: true } })
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (existing.status !== 'DRAFT') {
    return NextResponse.json({ error: 'Only a draft can be edited — this campaign has already been released.' }, { status: 409 })
  }

  const body = (await req.json().catch(() => null)) as {
    name?: string
    subject?: string
    bodyTemplate?: string
    segmentKey?: string | null
    roleKeys?: string[] | null
    excludePortalAccess?: boolean | null
  } | null
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 })

  const name = (body.name ?? '').trim()
  const subject = (body.subject ?? '').trim()
  const template = (body.bodyTemplate ?? '').trim()
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (!subject) return NextResponse.json({ error: 'subject required' }, { status: 400 })
  if (!template) return NextResponse.json({ error: 'body required' }, { status: 400 })

  const roleKeys = (body.roleKeys ?? []).filter(Boolean)
  const { recipients } = await resolveRecipients(
    { segmentKey: body.segmentKey, roleKeys, excludePortalAccess: body.excludePortalAccess },
    user.id,
    user.name ?? null,
  )
  if (recipients.length === 0) {
    return NextResponse.json({ error: 'That segment resolves to nobody sendable right now.' }, { status: 400 })
  }
  if (recipients.length > MAX_AUDIENCE) {
    return NextResponse.json(
      { error: `That segment is ${recipients.length} contacts. A single campaign is capped at ${MAX_AUDIENCE} — narrow it, or split it across days.` },
      { status: 400 },
    )
  }

  const statusCounts = await prisma.$transaction(async (tx) => {
    // Re-check inside the transaction: a release between the read above
    // and this write must not have its audit rows replaced.
    const updated = await tx.outreachCampaign.updateMany({
      where: { id, status: 'DRAFT' },
      data: {
        name,
        subject,
        bodyTemplate: template,
        segmentKey: body.segmentKey ?? null,
        roleKey: roleKeys.length > 0 ? roleKeys.join(',') : null,
      },
    })
    if (updated.count === 0) throw new Error('not-draft')
    // The rows belong to this draft alone; nothing has been sent from them.
    await tx.outreachCampaignRecipient.deleteMany({ where: { campaignId: id } })
    return writeRecipientSnapshot(tx, id, subject, template, recipients)
  }, { timeout: 30_000 }).catch((e) => {
    if (e instanceof Error && e.message === 'not-draft') return null
    throw e
  })
  if (!statusCounts) {
    return NextResponse.json({ error: 'Only a draft can be edited — this campaign has already been released.' }, { status: 409 })
  }

  return NextResponse.json({ id, statusCounts })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const deleted = await prisma.outreachCampaign.deleteMany({ where: { id, status: 'DRAFT' } })
  if (deleted.count === 0) {
    const exists = await prisma.outreachCampaign.findUnique({ where: { id }, select: { id: true } })
    return exists
      ? NextResponse.json({ error: 'Only a draft can be discarded — this campaign has already been released.' }, { status: 409 })
      : NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
