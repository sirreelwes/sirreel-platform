import { prisma } from '@/lib/prisma'

/**
 * Email-in-Job (step 6) — best-effort thread filing.
 *
 * Finds the email thread an Inquiry originated from (via
 * sourceMetadata.emailMessageId or rfc822MessageId) and files it in the
 * given Job — FILL-ONLY: a thread an operator already filed elsewhere
 * is never silently re-pointed. Called from the conversion choke points
 * (inquiries PATCH with convertedJobId, welcome send/start) where the
 * agent has just explicitly resolved the Job, so filing the source
 * thread is a consequence of that choice, not a guess.
 *
 * Never throws — filing is enrichment, not a gate.
 */
export async function attachInquiryThreadToJob(inquiryId: string, jobId: string): Promise<boolean> {
  try {
    const inquiry = await prisma.inquiry.findUnique({
      where: { id: inquiryId },
      select: { rfc822MessageId: true, sourceMetadata: true },
    })
    if (!inquiry) return false

    const meta = inquiry.sourceMetadata as Record<string, unknown> | null
    const emailMessageId = typeof meta?.emailMessageId === 'string' ? meta.emailMessageId : null

    let threadId: string | null = null
    if (emailMessageId) {
      const m = await prisma.emailMessage.findUnique({
        where: { id: emailMessageId },
        select: { threadId: true },
      })
      threadId = m?.threadId ?? null
    }
    if (!threadId && inquiry.rfc822MessageId) {
      const m = await prisma.emailMessage.findFirst({
        where: { rfc822MessageId: inquiry.rfc822MessageId, threadId: { not: null } },
        select: { threadId: true },
      })
      threadId = m?.threadId ?? null
    }
    if (!threadId) return false

    const r = await prisma.emailThread.updateMany({
      where: { id: threadId, jobId: null },
      data: { jobId },
    })
    return r.count > 0
  } catch (err) {
    console.warn('[attachInquiryThreadToJob] failed (non-blocking):', err instanceof Error ? err.message : err)
    return false
  }
}

/**
 * Fill-only variant for a known thread key (EmailThread.id or Gmail
 * thread id) — used by Quick Reply's post-resolution side effect.
 */
export async function fileThreadInJobIfUnfiled(threadKey: string, jobId: string): Promise<boolean> {
  try {
    const r = await prisma.emailThread.updateMany({
      where: { OR: [{ id: threadKey }, { gmailThreadId: threadKey }], jobId: null },
      data: { jobId },
    })
    return r.count > 0
  } catch (err) {
    console.warn('[fileThreadInJobIfUnfiled] failed (non-blocking):', err instanceof Error ? err.message : err)
    return false
  }
}
