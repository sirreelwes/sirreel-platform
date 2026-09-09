import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  JOB_SESSION_COOKIE,
  buildJobSessionCookieHeader,
  verifyJobSessionCookieValue,
} from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { resolveJobCoi } from '@/lib/coi/companyCoi'
import { confirmationAcknowledgment } from '@/lib/coi/jobCoiConfirmation'
import { notifyHqDocument } from '@/lib/email/notifyHqDocument'

export const dynamic = 'force-dynamic'

/**
 * POST /api/portal/job/coi-confirm
 *
 * The client answering "is the account's certificate the right insurance for
 * THIS job?" (Wes, 2026-09-09). Body: { decision: 'CONFIRMED' |
 * 'SEPARATE_POLICY', note?: string }.
 *
 * The answer is stored against the CERTIFICATE it was given about, so a
 * later cert re-opens the question — see src/lib/coi/jobCoiConfirmation.ts.
 * The acknowledgment text is recomposed HERE from the live resolution rather
 * than sent up by the browser: the sentence we keep has to be the sentence
 * they were actually shown, and a client-supplied one is neither trustworthy
 * nor necessarily current.
 *
 * SEPARATE_POLICY is accepted with no certificate on file — that is exactly
 * the case where the account cert was standing in wrongly and there is
 * nothing yet to replace it.
 */
export async function POST(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) return NextResponse.json({ error: 'No session' }, { status: 401 })

  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) {
    const res = NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })
    res.headers.append('Set-Cookie', buildJobSessionCookieHeader('', { clear: true }))
    return res
  }

  const body = await req.json().catch(() => ({}))
  const decision = body?.decision
  if (decision !== 'CONFIRMED' && decision !== 'SEPARATE_POLICY') {
    return NextResponse.json({ error: 'decision must be CONFIRMED or SEPARATE_POLICY' }, { status: 400 })
  }
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 2000) || null : null

  const order = await prisma.order.findUnique({
    where: { id: resolved.orderId },
    select: {
      id: true,
      jobId: true,
      orderNumber: true,
      agentId: true,
      company: { select: { name: true } },
      job: { select: { id: true, name: true, jobCode: true } },
    },
  })
  if (!order?.jobId) {
    return NextResponse.json({ error: 'This order is not attached to a job' }, { status: 400 })
  }

  const resolution = await resolveJobCoi(order.jobId)

  // Confirming requires something to confirm. Declaring a separate policy
  // does not — that answer is about the job, not about a document.
  if (decision === 'CONFIRMED' && !resolution) {
    return NextResponse.json({ error: 'There is no certificate on file to confirm' }, { status: 409 })
  }
  if (decision === 'CONFIRMED' && resolution?.source === 'JOB') {
    return NextResponse.json(
      { error: 'This job already has its own certificate — nothing to confirm' },
      { status: 409 },
    )
  }

  const contact = resolved.contact
  const confirmerName = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ').trim() || null

  // A SEPARATE_POLICY answer with no cert on file has no document to bind
  // to. The row requires one, so anchor it to whatever governed the job at
  // answer time; with nothing at all, there is no row to write and the
  // job simply keeps asking for a certificate.
  if (!resolution) {
    return NextResponse.json(
      { error: 'Upload this job’s certificate below — there is nothing on file to replace' },
      { status: 409 },
    )
  }

  const acknowledgmentText =
    decision === 'CONFIRMED'
      ? confirmationAcknowledgment(
          order.company?.name,
          resolution.coi.originalFilename,
          resolution.coi.policyExpiryDate,
        )
      : 'This job is insured under its own policy, not the certificate on file for the account.'

  const row = await prisma.jobCoiConfirmation.upsert({
    where: { jobId: order.jobId },
    create: {
      jobId: order.jobId,
      coiCheckId: resolution.coi.id,
      decision,
      note,
      confirmerName,
      confirmerEmail: contact?.email ?? null,
      acknowledgmentText,
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      userAgent: req.headers.get('user-agent')?.slice(0, 1000) || null,
      source: 'PORTAL_JOB',
    },
    update: {
      coiCheckId: resolution.coi.id,
      decision,
      note,
      decidedAt: new Date(),
      confirmerName,
      confirmerEmail: contact?.email ?? null,
      acknowledgmentText,
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      userAgent: req.headers.get('user-agent')?.slice(0, 1000) || null,
      source: 'PORTAL_JOB',
    },
    select: { id: true, decision: true, decidedAt: true, confirmerName: true, note: true, coiCheckId: true },
  })

  // Only the exception is worth an inbox. A client confirming the cert we
  // already hold is the expected answer and lands on the job page; a client
  // telling us the account policy does NOT cover this job changes what the
  // desk has to chase before pickup.
  if (decision === 'SEPARATE_POLICY') {
    notifyHqDocument({
      kind: 'coi',
      companyName: order.company?.name ?? null,
      jobName: order.job?.name ?? order.orderNumber,
      rows: [
        { label: 'What changed', value: 'The production carries its own insurance for this job' },
        {
          label: 'Account certificate',
          value: `${resolution.coi.originalFilename} — no longer standing in for this job`,
        },
        { label: 'Told us', value: confirmerName || contact?.email || 'the production' },
        ...(note ? [{ label: 'They added', value: note }] : []),
      ],
      warning:
        'This job now reads as awaiting its OWN certificate. It is not covered by the account policy — get the production\u2019s cert before pickup.',
      href: `${(process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')}/jobs/${order.jobId}`,
      replyTo: contact?.email ?? null,
      label: 'coi-separate-policy',
    })
  }

  return NextResponse.json({ ok: true, confirmation: row })
}
