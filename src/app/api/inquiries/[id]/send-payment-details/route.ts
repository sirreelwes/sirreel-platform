/**
 * Payment-info inquiry action (operator, getServerSession).
 *
 * GET  → eligibility info for the card: the requester's submitted
 *        address, whether it currently qualifies (resolves to a Person
 *        on a QUOTED/ACTIVE/WRAPPED job — the SAME test /payment-info
 *        uses), and whether payment details are configured. Drives the
 *        prominent "no qualifying job on file" flag.
 *
 * POST → send the current saved structured details + attachments (the
 *        exact branded email) to the submitted address. Wes ruled
 *        fast-send: the operator is the gate, so there is NO hard
 *        matched-Person requirement. Optional { companyId, jobId }
 *        associate the request so it stops being orphaned and future
 *        requests from this address qualify (the resolved Person is
 *        added as a JobContact on the attached Job). Marks the inquiry
 *        resolved (payment-specific, NOT "converted to quote") and
 *        audits the send (address/agent/company/job — never details).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { resolvePersonByEmail } from '@/lib/people/email'
import { sendPaymentDetailsEmail, loadPaymentRecord } from '@/lib/payments/sendPaymentDetails'

export const dynamic = 'force-dynamic'

const QUALIFYING = ['QUOTED', 'ACTIVE', 'WRAPPED']

/** The requester's submitted address is stored in the inquiry body as
 *  "Submitted email: {addr}" (payment-info route format). */
function parseSubmittedEmail(description: string): string | null {
  const m = description.match(/Submitted email:\s*(\S+@\S+)/i)
  return m ? m[1].trim().toLowerCase() : null
}

function isPaymentInfoInquiry(title: string): boolean {
  return title.trim().toLowerCase() === 'payment info request'
}

async function requireUser() {
  const session = await getServerSession()
  if (!session?.user?.email) return null
  return prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true },
  })
}

async function loadContext(inquiryId: string) {
  const inquiry = await prisma.inquiry.findUnique({
    where: { id: inquiryId },
    select: { id: true, title: true, description: true, status: true },
  })
  if (!inquiry || !isPaymentInfoInquiry(inquiry.title)) return null
  const submitted = parseSubmittedEmail(inquiry.description)
  return { inquiry, submitted }
}

/** Does this address currently resolve to a Person on a qualifying job? */
async function evaluateQualification(email: string) {
  const person = (await resolvePersonByEmail(email, {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      jobContacts: { select: { job: { select: { status: true } } } },
    },
  })) as
    | { id: string; firstName: string | null; lastName: string | null; jobContacts: Array<{ job: { status: string } }> }
    | null
  const qualifies = !!person && person.jobContacts.some((jc) => QUALIFYING.includes(jc.job.status))
  return { person, qualifies }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ctx = await loadContext(params.id)
  if (!ctx) return NextResponse.json({ error: 'not a payment-info inquiry' }, { status: 404 })

  const record = await loadPaymentRecord()
  const submitted = ctx.submitted
  let qualifies = false
  let personName: string | null = null
  if (submitted) {
    const q = await evaluateQualification(submitted)
    qualifies = q.qualifies
    personName = q.person ? `${q.person.firstName ?? ''} ${q.person.lastName ?? ''}`.trim() || null : null
  }

  return NextResponse.json({
    ok: true,
    submittedEmail: submitted,
    qualifies,
    personName,
    paymentConfigured: !!record,
    status: ctx.inquiry.status,
  })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ctx = await loadContext(params.id)
  if (!ctx) return NextResponse.json({ error: 'not a payment-info inquiry' }, { status: 404 })
  const submitted = ctx.submitted
  if (!submitted) {
    return NextResponse.json({ error: 'could not read the requester address from this inquiry' }, { status: 400 })
  }

  const body = (await req.json().catch(() => ({}))) as { companyId?: unknown; jobId?: unknown }
  const companyId = typeof body.companyId === 'string' && body.companyId ? body.companyId : null
  const jobId = typeof body.jobId === 'string' && body.jobId ? body.jobId : null

  // Resolve a Person for the submitted address (may be null — fast-send
  // does not require it). Used to note the sender + wire the JobContact.
  const { person } = await evaluateQualification(submitted)

  // Send the exact branded email + attachments.
  const result = await sendPaymentDetailsEmail({ to: submitted, firstName: person?.firstName ?? null })
  if (!result.ok) {
    if (result.reason === 'not_configured') {
      return NextResponse.json(
        { error: 'Payment details are not configured yet — set them in /admin/payment-info before sending.' },
        { status: 400 },
      )
    }
    return NextResponse.json({ error: `Email send failed: ${result.detail}` }, { status: 502 })
  }

  // Optional association — attach Company/Job so the request stops being
  // orphaned; if a Person resolved and a Job was picked, add the Person
  // as a JobContact so future requests from this address qualify.
  let jobContactLinked = false
  if (jobId && person) {
    const existing = await prisma.jobContact.findFirst({
      where: { jobId, personId: person.id },
      select: { id: true },
    })
    if (!existing) {
      await prisma.jobContact.create({
        data: { jobId, personId: person.id, role: 'ACCOUNTING' },
      })
      jobContactLinked = true
    }
  }

  // Mark the inquiry resolved — payment-specific, NOT "converted to
  // quote". Status CONVERTED is the terminal "handled" state; the
  // sourceMetadata marker drives the payment-specific banner (no
  // convertedJobId is set, so the quote-conversion banner never shows).
  const prior = await prisma.inquiry.findUnique({
    where: { id: params.id },
    select: { sourceMetadata: true },
  })
  const priorMeta =
    prior?.sourceMetadata && typeof prior.sourceMetadata === 'object' && !Array.isArray(prior.sourceMetadata)
      ? (prior.sourceMetadata as Record<string, unknown>)
      : {}
  await prisma.inquiry.update({
    where: { id: params.id },
    data: {
      status: 'CONVERTED',
      ...(companyId ? { companyId } : {}),
      ...(person ? { personId: person.id } : {}),
      sourceMetadata: {
        ...priorMeta,
        paymentDetailsSentAt: new Date().toISOString(),
        paymentDetailsSentTo: submitted,
        paymentDetailsSentById: user.id,
        ...(jobId ? { paymentJobId: jobId } : {}),
      },
    },
  })

  // Audit — address/agent/company/job only, NEVER the banking details.
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'inquiry.payment_details_sent',
      entityType: 'Inquiry',
      entityId: params.id,
      oldValues: { submittedEmail: submitted },
      newValues: {
        sentTo: submitted,
        companyId,
        jobId,
        personId: person?.id ?? null,
        jobContactLinked,
        attachmentsSent: result.attachmentsSent,
        attachmentsDropped: result.dropped.length,
        at: new Date().toISOString(),
      },
    },
  })

  return NextResponse.json({
    ok: true,
    sentTo: submitted,
    attachmentsSent: result.attachmentsSent,
    dropped: result.dropped,
    jobContactLinked,
  })
}
