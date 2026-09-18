/**
 * Tell the client their counter-proposal is in the portal — automatically,
 * once, when it is first posted (Wes 2026-09-15: "a very simple and polite
 * email auto sent when we submit our counter or acceptance of their
 * redlines").
 *
 * Once per review. The first generated counter-PDF sends it; a regenerate
 * (fixing a typo after looking at the PDF) does not mail the client again —
 * the job page card's "Send again" is the deliberate way to do that. Any
 * earlier send of this review, automatic or manual, counts.
 *
 * Skipped, with the reason handed back to the desk, when there is nowhere
 * to point them: no job, no job portal, no contact with an email, or the
 * review is not the one the portal shows.
 *
 * Addressed like the paperwork summary: the job's canonical contact (their
 * magic link is personal, so they are the only To), the sales desk CC'd,
 * replies to the person who posted it.
 */

import { prisma } from '@/lib/prisma'
import { sendOnJobThread } from '@/lib/email/jobThread'
import { agentReplyTo, withTeamCc } from '@/lib/email/teamVisibility'
import { pickCanonicalRecipient } from '@/lib/email/recipients'
import { refreshOrIssueJobMagicLink } from '@/lib/portal/jobMagicLink'
import { portalJobUrl } from '@/lib/portal/portalUrl'
import { resolveDisplayJobName } from '@/lib/jobs/displayName'
import { buildCounterNoticeEmail } from '@/lib/email/templates/counterProposalNotice'
import { COUNTER_SENT_ACTION, latestCounterProposalForJob } from './jobCounterProposal'

export type CounterNoticeResult =
  | { sent: true; to: string }
  | { sent: false; reason: string }

export async function notifyClientOfCounter(args: { reviewId: string; senderUserId: string }): Promise<CounterNoticeResult> {
  const review = await prisma.contractReview.findUnique({
    where: { id: args.reviewId },
    select: { id: true, jobId: true, deletedAt: true },
  })
  if (!review || review.deletedAt) return { sent: false, reason: 'review not found' }
  if (!review.jobId) return { sent: false, reason: 'This review is not linked to a job, so there is no portal to point them to.' }

  const current = await latestCounterProposalForJob(review.jobId)
  if (current?.id !== review.id) {
    return { sent: false, reason: "This isn't the counter-proposal the client's portal shows." }
  }

  const already = await prisma.auditLog.findFirst({
    where: { action: COUNTER_SENT_ACTION, entityType: 'contract_review', entityId: review.id },
    select: { id: true },
  })
  if (already) return { sent: false, reason: 'Already emailed for this review — use Send again on the job page to resend.' }

  const [job, portalOrder, sender] = await Promise.all([
    prisma.job.findUnique({
      where: { id: review.jobId },
      select: {
        name: true,
        company: { select: { name: true } },
        jobContacts: {
          select: { role: true, isPrimary: true, person: { select: { id: true, firstName: true, lastName: true, email: true } } },
        },
      },
    }),
    prisma.order.findFirst({
      where: { jobId: review.jobId, status: { not: 'CANCELLED' }, portalSlug: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, portalSlug: true },
    }),
    prisma.user.findUnique({ where: { id: args.senderUserId }, select: { name: true, email: true } }),
  ])
  if (!job) return { sent: false, reason: 'job not found' }
  if (!portalOrder?.portalSlug) return { sent: false, reason: 'This job has no client portal yet, so there is nothing to point them to.' }

  const to = pickCanonicalRecipient(job, null)
  if (!to?.email) return { sent: false, reason: 'No contact with an email on this job.' }

  const link = await refreshOrIssueJobMagicLink({ orderId: portalOrder.id, contactId: to.id })
  const portalUrl = `${portalJobUrl(portalOrder.portalSlug, link.token)}#paperwork`

  const { subject, html, text } = buildCounterNoticeEmail({
    firstName: to.name.split(' ')[0] || null,
    projectName: resolveDisplayJobName({ jobName: job.name, companyName: job.company?.name ?? null }),
    portalUrl,
    senderName: sender?.name ?? null,
  })
  const cc = await withTeamCc([], to.email)
  const result = await sendOnJobThread({
    jobId: review.jobId,
    staffEmail: sender?.email ?? null,
    to: [to.email],
    cc: cc.length ? cc : undefined,
    replyTo: agentReplyTo(sender?.email) ?? undefined,
    subject,
    html,
    text,
    orderId: portalOrder.id,
    label: 'contract-review/counter-notice',
  })
  if (!result.ok) return { sent: false, reason: `The email didn't go out: ${result.reason || 'send failed'}` }

  // Same action as a manual send, so the card reads "Emailed to … " and the
  // once-per-review rule sees it.
  await prisma.auditLog
    .create({
      data: {
        userId: args.senderUserId,
        action: COUNTER_SENT_ACTION,
        entityType: 'contract_review',
        entityId: review.id,
        newValues: { jobId: review.jobId, to: to.email, cc, subject, auto: true },
      },
    })
    .catch((err) => console.error('[counter-notice] audit failed:', err))

  return { sent: true, to: to.email }
}
