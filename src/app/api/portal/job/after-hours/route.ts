/**
 * GET /api/portal/job/after-hours — the client's after-hours instructions.
 *
 * Answers ONLY when both are true:
 *   1. a valid, unrevoked job portal session (the same JOB_SESSION_COOKIE
 *      every other /api/portal/job route reads), and
 *   2. an agent has released after-hours access for THIS job.
 *
 * Either missing → 403 with a sentence the client can act on, not a bare
 * error. "Ask your rep" is the correct next step and the page says so.
 *
 * A release that has been revoked stops answering here, immediately, on
 * the next load — which is the difference between this and the PDF it
 * replaces. Every successful read is audit-logged: if a code ever walks,
 * there is a list of which jobs saw it and when.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { JOB_SESSION_COOKIE, verifyJobSessionCookieValue } from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { resolveJobPortalRead } from '@/lib/portal/jobPreview'
import { afterHoursPayload } from '@/lib/afterHours/instructions'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const read = await resolveJobPortalRead(req)
  if (!read) return NextResponse.json({ error: 'No session' }, { status: 401 })

  const resolved = read.resolved
  if (!resolved) return NextResponse.json({ error: 'No session' }, { status: 401 })

  const order = await prisma.order.findUnique({
    where: { id: resolved.orderId },
    select: {
      id: true,
      orderNumber: true,
      company: { select: { name: true, logoUrl: true, logoSvg: true } },
      job: {
        select: {
          id: true,
          jobCode: true,
          name: true,
          afterHoursReleasedAt: true,
          afterHoursNote: true,
          agent: { select: { name: true, email: true, phone: true } },
        },
      },
    },
  })
  const job = order?.job
  if (!job) {
    return NextResponse.json(
      { error: 'not_released', message: 'There are no after-hours instructions on this project.' },
      { status: 403 },
    )
  }

  if (!job.afterHoursReleasedAt) {
    return NextResponse.json(
      {
        error: 'not_released',
        message:
          'After-hours access has not been set up for this project yet. Ask your SirReel rep to send it over — it takes them one click.',
        // The page still wears the company while it says so.
        projectName: job.name,
        jobCode: job.jobCode ?? order?.orderNumber ?? null,
        company: order?.company
          ? { name: order.company.name, hasLogo: !!(order.company.logoSvg || order.company.logoUrl) }
          : null,
        contact: resolved.contact
          ? { firstName: resolved.contact.firstName, lastName: resolved.contact.lastName, email: resolved.contact.email }
          : null,
        agent: job.agent ? { name: job.agent.name, email: job.agent.email, phone: job.agent.phone } : null,
      },
      { status: 403 },
    )
  }

  const payload = await afterHoursPayload()

  await prisma.auditLog.create({
    data: {
      // The viewer is a client, not a User — the portal access row IS the
      // identity, and it names the contact.
      userId: null,
      action: 'job.after_hours_viewed',
      entityType: 'job',
      entityId: job.id,
      newValues: {
        portalAccessId: read.previewBy ? null : resolved.portalAccessId,
        // A staff preview is not a client view — say so in the audit row
        // rather than leaving a look that reads like the client's.
        staffPreviewBy: read.previewBy,
        contactId: resolved.contactId,
        orderId: order.id,
      },
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    },
  })

  return NextResponse.json({
    // Staff preview, so the shared masthead can wear its banner here too.
    preview: read.previewBy
      ? {
          by: read.previewBy,
          backUrl: `${(process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')}/jobs/${job.id}`,
        }
      : null,
    projectName: job.name,
    // Chrome facts for the job portal's shared masthead (JobPortalChrome).
    company: order?.company
      ? { name: order.company.name, hasLogo: !!(order.company.logoSvg || order.company.logoUrl) }
      : null,
    contact: resolved.contact
      ? { firstName: resolved.contact.firstName, lastName: resolved.contact.lastName, email: resolved.contact.email }
      : null,
    jobCode: job.jobCode ?? order?.orderNumber ?? null,
    note: job.afterHoursNote,
    releasedAt: job.afterHoursReleasedAt,
    agent: job.agent
      ? { name: job.agent.name, email: job.agent.email, phone: job.agent.phone }
      : null,
    ...payload,
  })
}
