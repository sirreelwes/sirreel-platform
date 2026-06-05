/**
 * POST /api/portal/add-on-request
 *
 * Logged-in portal client requests an add-on to a job they're a
 * contact on. We DON'T create the Order here — that would let a
 * client bypass rep review. Instead we create one
 * Inquiry(WEB_FORM, NEW) tagged with `sourceMetadata.kind =
 * 'portal-add-on'` and `targetJobId`. The rep sees it in
 * NewInboundColumn with a "Portal" pill; clicking "Add on to
 * existing job" opens the phase-1b modal with the targeted job
 * pre-selected.
 *
 * Auth: PersonSession cookie (sr_person_session). Same pattern as
 * /portal/account — verify HMAC, look up PersonSession row,
 * re-check revokedAt + magicLinkUsedAt. The cookie alone is NOT
 * authorization.
 *
 * Permission: the person MUST be on the job's JobContact roster.
 * No exception for "company default agent" / "Person.assignedAgent"
 * etc — JobContact membership is the only signal that means "this
 * person is involved with this production." Without it, the
 * endpoint 403s without leaking whether the job exists.
 *
 * Body: { jobId: string, notes?: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import {
  PERSON_SESSION_COOKIE,
  verifyPersonSessionCookieValue,
} from '@/lib/portal/personSession'

export const dynamic = 'force-dynamic'

const NOTES_MAX = 5000

export async function POST(req: NextRequest) {
  // ── Verify the cookie + session row ───────────────────────
  const cookieValue = cookies().get(PERSON_SESSION_COOKIE)?.value
  const verified = verifyPersonSessionCookieValue(cookieValue)
  if (!verified) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const session = await prisma.personSession.findUnique({
    where: { id: verified.personSessionId },
    select: {
      id: true,
      revokedAt: true,
      magicLinkUsedAt: true,
      person: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
    },
  })
  if (!session || session.revokedAt || !session.magicLinkUsedAt) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const person = session.person

  // ── Validate body ─────────────────────────────────────────
  const body = (await req.json().catch(() => ({}))) as {
    jobId?: unknown
    notes?: unknown
  }
  const jobId =
    typeof body.jobId === 'string' && body.jobId.trim() ? body.jobId.trim() : null
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })
  const notes =
    typeof body.notes === 'string'
      ? body.notes.trim().slice(0, NOTES_MAX) || null
      : null

  // ── Permission: JobContact membership ─────────────────────
  // We check this as the FIRST authorization step. If the person
  // isn't on the job's roster, the response is 403 without echoing
  // job details — same shape as if the job didn't exist.
  const membership = await prisma.jobContact.findFirst({
    where: { jobId, personId: person.id },
    select: {
      role: true,
      isPrimary: true,
      job: {
        select: {
          id: true,
          jobCode: true,
          name: true,
          status: true,
          companyId: true,
          agentId: true,
        },
      },
    },
  })
  if (!membership) {
    return NextResponse.json(
      { error: 'not authorized for this job' },
      { status: 403 },
    )
  }
  const job = membership.job

  // Don't allow add-ons to terminal jobs — same rule the rep's
  // phase 1b endpoint enforces.
  if (job.status === 'WRAPPED' || job.status === 'LOST') {
    return NextResponse.json(
      { error: `job ${job.jobCode} is ${job.status} — contact your rep` },
      { status: 409 },
    )
  }

  // ── Idempotency: avoid double-clicks creating duplicate NEW
  // inquiries against the same job in the same minute. We don't
  // need a partial unique index here — a short-window read is
  // enough for the rare "client clicks twice" case.
  const recentDuplicate = await prisma.inquiry.findFirst({
    where: {
      source: 'WEB_FORM',
      status: 'NEW',
      personId: person.id,
      sourceMetadata: { path: ['targetJobId'], equals: jobId },
      createdAt: { gte: new Date(Date.now() - 60_000) },
    },
    select: { id: true },
  })
  if (recentDuplicate) {
    return NextResponse.json({
      ok: true,
      inquiry: { id: recentDuplicate.id },
      deduped: true,
    })
  }

  // ── Write ─────────────────────────────────────────────────
  const fullName = `${person.firstName} ${person.lastName}`.trim()
  const title = `Add-on request — ${job.name}`
  const description = [
    `Portal add-on request from ${fullName} <${person.email}>`,
    `Production: ${job.name} (${job.jobCode})`,
    `Role on job: ${membership.role}${membership.isPrimary ? ' · primary' : ''}`,
    notes ? `\nClient notes:\n${notes}` : '\n(No notes provided.)',
  ].join('\n')

  const inquiry = await prisma.inquiry.create({
    data: {
      title,
      description,
      source: 'WEB_FORM',
      status: 'NEW',
      companyId: job.companyId,
      personId: person.id,
      assignedToId: job.agentId,
      sourceMetadata: {
        kind: 'portal-add-on',
        targetJobId: job.id,
        targetJobCode: job.jobCode,
        targetJobName: job.name,
        requesterPersonId: person.id,
        requesterName: fullName,
        requesterEmail: person.email,
        notes,
        submittedAt: new Date().toISOString(),
      },
    },
    select: { id: true },
  })

  return NextResponse.json(
    { ok: true, inquiry: { id: inquiry.id } },
    { status: 201 },
  )
}
