/**
 * POST /api/portal/job/after-hours/share — the client forwards the run.
 *
 * Wes, 2026-09-02: the client is usually sending this to their truck driver
 * or a PA. Before this they had exactly one way to do that — forward the
 * email we sent them, which would have handed a driver a magic link into
 * their own project portal (quote, totals, invoice, paperwork). So the
 * client gets a proper share button and the driver gets a credential that
 * opens one page.
 *
 * Gated on the same two facts as the read: a live portal session, and a
 * released job. Rate-limited per session — a coordinator sends this two or
 * three times a shoot, and a portal session that has minted a dozen share
 * links in ten minutes is not a coordinator.
 *
 * GET lists the shares this job already has, so the client can see who they
 * sent it to and take one back.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { JOB_SESSION_COOKIE, verifyJobSessionCookieValue } from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { checkRateLimit } from '@/lib/portal/publicRateLimit'
import { shareAfterHours, SHARE_TTL_DAYS } from '@/lib/afterHours/share'

export const dynamic = 'force-dynamic'

/** Generous for a real coordinator, tight for a script. */
const SHARE_POLICY = { windowMs: 10 * 60_000, max: 6 }

async function resolve(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) return null
  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) return null
  const order = await prisma.order.findUnique({
    where: { id: resolved.orderId },
    select: { job: { select: { id: true, afterHoursReleasedAt: true } } },
  })
  if (!order?.job) return null
  return {
    portalAccessId: session.portalAccessId,
    job: order.job,
    contact: resolved.contact,
    companyName: resolved.order.company?.name || null,
  }
}

export async function GET(req: NextRequest) {
  const ctx = await resolve(req)
  if (!ctx) return NextResponse.json({ error: 'No session' }, { status: 401 })
  if (!ctx.job.afterHoursReleasedAt) {
    return NextResponse.json({ shares: [] })
  }
  const shares = await prisma.afterHoursShare.findMany({
    where: { jobId: ctx.job.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, email: true, name: true, createdAt: true, expiresAt: true, viewedAt: true },
  })
  return NextResponse.json({ shares, ttlDays: SHARE_TTL_DAYS })
}

export async function POST(req: NextRequest) {
  const ctx = await resolve(req)
  if (!ctx) return NextResponse.json({ error: 'No session' }, { status: 401 })
  if (!ctx.job.afterHoursReleasedAt) {
    return NextResponse.json(
      { error: 'After-hours access is not turned on for this project yet.' },
      { status: 403 },
    )
  }

  const limit = checkRateLimit(`ah-share:${ctx.portalAccessId}`, SHARE_POLICY)
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: `That's a lot of links at once — try again in ${Math.ceil(
          limit.retryAfterSeconds / 60,
        )} minutes, or call us and we'll sort it out.`,
      },
      { status: 429 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as {
    email?: string
    name?: string
    message?: string
  }

  // Revoke path lives here too — one surface for "who has this".
  const senderName =
    [ctx.contact?.firstName, ctx.contact?.lastName]
      .filter((s) => s && s !== '—')
      .join(' ')
      .trim() || ctx.companyName

  const result = await shareAfterHours({
    jobId: ctx.job.id,
    email: body.email || '',
    recipientName: body.name?.slice(0, 120) || null,
    message: body.message?.slice(0, 1000) || null,
    senderName,
    sharedByPortalAccessId: ctx.portalAccessId,
  })

  if (!result.ok) {
    const status = result.reason === 'bad_email' ? 400 : result.reason === 'send_failed' ? 502 : 403
    return NextResponse.json({ error: result.message }, { status })
  }
  return NextResponse.json({ ok: true, email: result.email, expiresAt: result.expiresAt })
}

/** Take a link back — a driver came off the job, or it went to a typo. */
export async function DELETE(req: NextRequest) {
  const ctx = await resolve(req)
  if (!ctx) return NextResponse.json({ error: 'No session' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Scoped to this job, so a session cannot revoke another job's share by id.
  const { count } = await prisma.afterHoursShare.updateMany({
    where: { id, jobId: ctx.job.id, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  if (count === 0) return NextResponse.json({ error: 'not found' }, { status: 404 })

  await prisma.auditLog.create({
    data: {
      action: 'job.after_hours_share_revoked',
      entityType: 'job',
      entityId: ctx.job.id,
      newValues: { shareId: id, by: 'client', portalAccessId: ctx.portalAccessId },
    },
  })
  return NextResponse.json({ ok: true })
}
