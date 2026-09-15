/**
 * GET /api/jobs/[id]/counter-proposal — the job page's counter-proposal card.
 *
 * Wes 2026-09-15: the generated counter-PDF goes to the job portal AND the
 * agent's job detail page, "and in the portal we can also choose to send to
 * the client." This returns what that card needs: which review, when it was
 * generated, the tally of decisions, when it was last emailed and to whom,
 * and the drafted cover note (the same `buildCounterEmail` text the review
 * desk has always offered to copy) to seed the "Send to client" composer.
 *
 * Reads only. The send goes through POST /api/jobs/[id]/email with
 * `counterReviewId`, which re-checks the review and attaches the PDF.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildCounterEmail } from '@/lib/contracts/buildCounterEmail'
import { pickPrimaryContact } from '@/lib/jobs/primaryContact'
import { COUNTER_SENT_ACTION, latestCounterProposalForJob } from '@/lib/contracts/jobCounterProposal'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const me = await prisma.user.findUnique({ where: { email: session.user.email }, select: { name: true } })
  if (!me) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const current = await latestCounterProposalForJob(params.id)
  if (!current) return NextResponse.json({ ok: true, counter: null })

  const [review, job, lastSent] = await Promise.all([
    prisma.contractReview.findUnique({
      where: { id: current.id },
      select: {
        aiResponse: true,
        counterGeneratedBy: { select: { name: true } },
        changeDecisions: { select: { clauseRef: true, decision: true, note: true, changeIndex: true } },
        signedAgreement: { select: { status: true, order: { select: { orderNumber: true } } } },
      },
    }),
    prisma.job.findUnique({
      where: { id: params.id },
      select: {
        name: true,
        jobCode: true,
        company: { select: { name: true } },
        jobContacts: {
          select: { role: true, isPrimary: true, person: { select: { firstName: true, lastName: true, email: true } } },
        },
      },
    }),
    prisma.auditLog.findFirst({
      where: { action: COUNTER_SENT_ACTION, entityType: 'contract_review', entityId: current.id },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, newValues: true, user: { select: { name: true } } },
    }),
  ])
  if (!review || !job) return NextResponse.json({ ok: true, counter: null })

  const decisions = review.changeDecisions
  const counts = {
    accept: decisions.filter((d) => d.decision === 'ACCEPT').length,
    counter: decisions.filter((d) => d.decision === 'COUNTER').length,
    reject: decisions.filter((d) => d.decision === 'REJECT').length,
  }

  const primary = pickPrimaryContact(job.jobContacts)
  const aiChanges = Array.isArray((review.aiResponse as { changes?: unknown } | null)?.changes)
    ? ((review.aiResponse as { changes: unknown[] }).changes as Parameters<typeof buildCounterEmail>[0]['aiChanges'])
    : []
  const preset = buildCounterEmail({
    aiChanges,
    decisions,
    company: { name: job.company?.name ?? null },
    job: { jobCode: job.jobCode, name: job.name },
    primaryContact: primary
      ? {
          fullName: [primary.person.firstName, primary.person.lastName].filter(Boolean).join(' ') || null,
          email: primary.person.email,
        }
      : null,
    senderName: me.name || 'the SirReel team',
    omitSignature: true,
    extraParagraph:
      "The same document is on your job portal under Paperwork, so everyone on your team can read it there.",
  })

  const sentTo = (lastSent?.newValues as { to?: unknown } | null)?.to
  return NextResponse.json({
    ok: true,
    counter: {
      reviewId: current.id,
      generatedAt: current.counterGeneratedAt,
      generatedBy: review.counterGeneratedBy?.name ?? null,
      counts,
      agreement: review.signedAgreement
        ? { status: review.signedAgreement.status, orderNumber: review.signedAgreement.order?.orderNumber ?? null }
        : null,
      lastSent: lastSent
        ? {
            at: lastSent.createdAt,
            to: typeof sentTo === 'string' ? sentTo : null,
            by: lastSent.user?.name ?? null,
            // A regenerate after the send means the client has an older copy.
            beforeRegenerate: !!current.counterGeneratedAt && lastSent.createdAt < current.counterGeneratedAt,
          }
        : null,
      preset,
    },
  })
}
