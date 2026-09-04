import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { CANONICAL_CLAUSES } from '@/lib/contracts/contractClauses'
import { pickCanonicalRecipient } from '@/lib/email/recipients'

export const dynamic = 'force-dynamic'

/**
 * POST /api/orders/[id]/agreement/redline
 *
 * OPERATOR-ENTERED REDLINE — the staff-side twin of the portal's
 * upload-redline routes.
 *
 * A client redline does not always arrive as an annotated PDF the AI can
 * read. It arrives as an email listing "Section 5, strike the red and add
 * the green", as a Word doc with tracked changes, as a phone call. Until
 * now HQ had nowhere to put that: /tools/contract-review only accepts a
 * PDF, and the review it creates is an ORPHAN — nothing links it to the
 * order's SignedAgreement, so the "Accept as Final" handoff (the one
 * thing that makes a negotiated agreement signable) never appears.
 *
 * This route closes both gaps at once. The operator supplies the AGREED
 * text of each amended clause; we synthesize the same `changes[]` shape
 * the AI produces, pre-decide every one as ACCEPT (an operator typing the
 * agreed language IS the approval — decidedBy/decidedAt record who), and
 * link the review to the order's rental agreement at REDLINE_UPLOADED.
 * From there the existing desk flow is unchanged: generate the
 * counter-PDF, Accept as Final, client signs in the portal.
 *
 * Scope is the JOB, never the company. ContractReview is job-scoped and
 * the counter-PDF is generated per review, so accepting a redline here
 * papers THIS job only — a standing change to a client's terms is
 * Company.negotiatedTerms* / CompanyAgreement, deliberately not this.
 *
 * Body:
 *   {
 *     amendments: [{ clauseRef: '5', proposed: '<full amended clause>', note? }],
 *     sourceNote?: 'Redline emailed by the production 2026-09-04'
 *   }
 */

interface AmendmentInput {
  clauseRef?: unknown
  proposed?: unknown
  note?: unknown
}

// Mirrors ContractDocument.resolveClause's ACCEPT guard. That renderer
// silently falls back to the BASELINE clause when the accepted text looks
// like a summary rather than a clause — which would hand the client an
// agreement that reads as though we ignored their redline. Fail here,
// loudly, rather than there, silently.
function tooShortForClause(proposed: string, canonicalBody: string): boolean {
  return proposed.length < 80 || proposed.length < canonicalBody.length * 0.5
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sessionUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true, email: true },
  })
  if (!sessionUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    amendments?: unknown
    sourceNote?: unknown
  }
  const rawAmendments = Array.isArray(body.amendments) ? (body.amendments as AmendmentInput[]) : []
  const sourceNote = typeof body.sourceNote === 'string' ? body.sourceNote.trim() : ''

  if (rawAmendments.length === 0) {
    return NextResponse.json(
      { error: 'No amendments supplied — send at least one clause.' },
      { status: 400 },
    )
  }

  const clauseByRef = new Map(CANONICAL_CLAUSES.map((c) => [c.ref, c]))
  const seen = new Set<string>()
  const amendments: Array<{ ref: string; title: string; original: string; proposed: string; note: string | null }> = []

  for (const a of rawAmendments) {
    const ref = String(a.clauseRef ?? '').trim()
    const proposed = String(a.proposed ?? '').trim()
    const note = typeof a.note === 'string' && a.note.trim() ? a.note.trim() : null
    const canonical = clauseByRef.get(ref)
    if (!canonical) {
      return NextResponse.json(
        { error: `Clause "${ref}" is not one of the rental agreement's numbered clauses.` },
        { status: 400 },
      )
    }
    if (seen.has(ref)) {
      return NextResponse.json(
        { error: `Clause ${ref} appears twice — combine the edits into one entry.` },
        { status: 400 },
      )
    }
    if (proposed === canonical.body) {
      return NextResponse.json(
        { error: `Clause ${ref} (${canonical.title}) is unchanged from the standard text.` },
        { status: 400 },
      )
    }
    if (tooShortForClause(proposed, canonical.body)) {
      return NextResponse.json(
        {
          error:
            `Clause ${ref} (${canonical.title}) needs the FULL amended clause, not a summary of the edit. ` +
            'Paste the whole clause as it should read once the change is made.',
        },
        { status: 400 },
      )
    }
    seen.add(ref)
    amendments.push({ ref, title: canonical.title, original: canonical.body, proposed, note })
  }

  // Keep clause order stable and human — 5 before 8 before 14.
  const orderOfRef = new Map(CANONICAL_CLAUSES.map((c, i) => [c.ref, i]))
  amendments.sort((a, b) => (orderOfRef.get(a.ref) ?? 0) - (orderOfRef.get(b.ref) ?? 0))

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      orderNumber: true,
      jobId: true,
      companyId: true,
      job: { select: { id: true, jobCode: true, name: true } },
      signedAgreements: {
        where: { contractType: 'RENTAL_AGREEMENT' },
        take: 1,
        select: { id: true, status: true, contractReviewId: true },
      },
    },
  })
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }
  const agreement = order.signedAgreements[0] ?? null
  if (!agreement) {
    return NextResponse.json(
      { error: 'Order has no rental agreement yet — generate one before entering a redline.' },
      { status: 409 },
    )
  }
  if (agreement.status === 'SIGNED_BASELINE' || agreement.status === 'SIGNED_NEGOTIATED') {
    return NextResponse.json(
      {
        error:
          'This agreement is already signed. Re-issue it (Reissue agreement) before entering a redline.',
        currentStatus: agreement.status,
      },
      { status: 409 },
    )
  }

  const enteredBy = sessionUser.name || sessionUser.email
  const aiResponse = {
    summary:
      `Redline entered by ${enteredBy} and approved for this job. ` +
      `${amendments.length} clause${amendments.length === 1 ? '' : 's'} amended: ` +
      amendments.map((a) => a.ref).join(', ') + '.',
    riskLevel: 'low',
    autoApprovedCount: amendments.length,
    needsReviewCount: 0,
    notAcceptableCount: 0,
    recommendation: 'accept',
    recommendationNote: sourceNote || 'Approved for this job only.',
    comparisonPerformed: false,
    comparisonNote:
      'Operator-entered redline — the amended clause text was supplied directly, not extracted from a client PDF.',
    changes: amendments.map((a) => ({
      clause: a.ref,
      type: 'auto_approved',
      description: `Client redline to clause ${a.ref} — ${a.title}`,
      original: a.original,
      proposed: a.proposed,
      reasoning: a.note || 'Entered from the redline the client sent back.',
      suggestedCounter: null,
      counterReasoning: null,
      playbookSource: 'operator_entered',
      needsOperatorReview: false,
      operatorReviewReason: null,
    })),
    _meta: {
      source: 'OPERATOR_ENTERED',
      enteredById: sessionUser.id,
      enteredByName: enteredBy,
      enteredAt: new Date().toISOString(),
      sourceNote: sourceNote || null,
      orderId: order.id,
      orderNumber: order.orderNumber,
    },
  }

  const now = new Date()
  const review = await prisma.$transaction(async (tx) => {
    const created = await tx.contractReview.create({
      data: {
        // No source file: the redline arrived as prose, not a PDF.
        fileKey: null,
        fileUrl: null,
        originalFilename: `Approved redline · ${order.job?.jobCode ?? order.orderNumber}`,
        fileSize: 0,
        mimeType: 'text/plain',
        jobId: order.jobId,
        companyId: order.companyId,
        uploadedById: sessionUser.id,
        aiResponse,
        aiRiskLevel: 'low',
        aiRecommendation: 'accept',
        // Empty on purpose and meaningful: there were no PDF annotations
        // to extract, because there was no PDF.
        annotationManifest: { strikes: [], insertions: [], source: 'OPERATOR_ENTERED' },
        humanDecision: 'APPROVED',
        humanDecisionNote: sourceNote || 'Redline approved for this job.',
        humanDecisionById: sessionUser.id,
        humanDecisionAt: now,
        changeDecisions: {
          create: amendments.map((a, i) => ({
            clauseRef: a.ref,
            changeType: 'auto_approved',
            changeIndex: i,
            decision: 'ACCEPT' as const,
            note: a.note,
            decidedById: sessionUser.id,
            decidedAt: now,
          })),
        },
      },
      select: { id: true },
    })

    await tx.signedAgreement.update({
      where: { id: agreement.id },
      data: {
        contractReviewId: created.id,
        status: 'REDLINE_UPLOADED',
      },
    })

    return created
  })

  await prisma.auditLog.create({
    data: {
      action: 'agreement.redline_entered',
      entityType: 'Order',
      entityId: order.id,
      userId: sessionUser.id,
      newValues: {
        reviewId: review.id,
        agreementId: agreement.id,
        clauses: amendments.map((a) => a.ref),
        sourceNote: sourceNote || null,
      },
    },
  }).catch(() => {
    // Audit is best-effort — never fail the redline on a log write.
  })

  return NextResponse.json({
    ok: true,
    reviewId: review.id,
    agreementId: agreement.id,
    status: 'REDLINE_UPLOADED',
    clauses: amendments.map((a) => ({ ref: a.ref, title: a.title })),
  })
}

/**
 * GET /api/orders/[id]/agreement/redline
 *
 * Who the "send for signature" step will actually email. Shown BEFORE the
 * send, not reported after it: the ranked recipient is often not the person
 * who mailed the redline (primary-flagged contacts outrank the PM role), and
 * discovering that from a delivery receipt is discovering it too late.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      orderNumber: true,
      jobContact: { select: { id: true, firstName: true, lastName: true, email: true } },
      job: {
        select: {
          jobContacts: {
            select: {
              role: true,
              isPrimary: true,
              person: { select: { id: true, firstName: true, lastName: true, email: true } },
            },
          },
        },
      },
    },
  })
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  const picked =
    order.jobContact?.email
      ? {
          id: order.jobContact.id,
          email: order.jobContact.email,
          name: [order.jobContact.firstName, order.jobContact.lastName].filter(Boolean).join(' '),
        }
      : pickCanonicalRecipient(order.job, order.jobContact)

  return NextResponse.json({
    ok: true,
    recipient: picked?.email ? { name: picked.name || null, email: picked.email } : null,
  })
}
