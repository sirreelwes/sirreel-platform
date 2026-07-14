import { prisma } from '@/lib/prisma'
import { nextOrderNumber } from '@/lib/orders'
import { issueJobMagicLink } from '@/lib/portal/jobMagicLink'
import { portalJobUrl } from '@/lib/portal/portalUrl'
import {
  ensureSignedAgreementForOrder,
  ensureBaselineRentalDocumentToSign,
} from '@/lib/orders/signedAgreement'

/**
 * The CLIENT's "Get Paperwork Started" click — core logic behind
 * POST /api/portal/welcome/[token]/start (kept in a lib so the route stays a
 * thin wrapper and the verification harness exercises the REAL code path).
 *
 * FIRST click, one transaction: atomically claim the invite → create the
 * Order (DRAFT; portalSlug auto-mints — the portal container) inside the
 * Job the AGENT resolved at send time (invite.jobId — Job-as-root step 4;
 * this lib creates NO Job) → Inquiry CONVERTED + convertedJobId → stamp
 * the invite. After the tx (best-effort): baseline agreement generated +
 * released, then a fresh magic link into the job portal.
 *
 * IDEMPOTENCY (layered):
 *   1. Atomic claim — updateMany({ id, usedAt: null }) → exactly one
 *      concurrent request wins; losers poll for the winner's stamp and
 *      resolve into the SAME portal.
 *   2. WelcomeInvite.inquiryId + Inquiry.convertedJobId are @unique — DB
 *      backstops making two jobs for one inquiry unrecordable.
 *   3. Every later click (used invite, even expired-after-use) resolves to
 *      the same job/order with a fresh magic link.
 *
 * Returns { kind: 'redirect', url } into the portal, or { kind: 'landing' }
 * when the click can't proceed (invalid/expired/failed) — the route bounces
 * those back to the zero-write landing page, which renders the friendly copy.
 */
export type WelcomeStartResult = { kind: 'redirect'; url: string } | { kind: 'landing' }

export async function startWelcomeInvite(token: string): Promise<WelcomeStartResult> {
  const landing: WelcomeStartResult = { kind: 'landing' }
  if (!token) return landing

  const invite = await prisma.welcomeInvite.findUnique({
    where: { token },
    select: {
      id: true,
      expiresAt: true,
      usedAt: true,
      jobId: true,
      createdJobId: true,
      createdOrderId: true,
      personId: true,
      inquiry: {
        select: {
          id: true,
          title: true,
          companyId: true,
          assignedToId: true,
          convertedJobId: true,
          estimatedValue: true,
          preferredStartDate: true,
          preferredEndDate: true,
        },
      },
    },
  })
  if (!invite) return landing

  // Resolve path — the job already exists (this or an earlier click):
  // re-issue a magic link into the SAME portal.
  const resolveToExisting = async (orderId: string): Promise<WelcomeStartResult> => {
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { portalSlug: true } })
    if (!order?.portalSlug) return landing
    const issued = await issueJobMagicLink({ orderId, contactId: invite.personId })
    return { kind: 'redirect', url: portalJobUrl(order.portalSlug, issued.token) }
  }
  if (invite.createdOrderId) return resolveToExisting(invite.createdOrderId)

  // Not yet used: expiry applies only to the FIRST activation.
  if (invite.expiresAt < new Date()) return landing

  const inquiry = invite.inquiry
  if (!inquiry.assignedToId) {
    // Should not happen (the send route pins the agent).
    console.error('[welcome/start] inquiry missing agent:', inquiry.id)
    return landing
  }
  // Job-as-root: the Job was resolved by the agent at SEND time. An
  // invite without one predates step 4 — it can't mint; the agent
  // re-sends the welcome (which now requires the resolver).
  if (!invite.jobId) {
    console.error('[welcome/start] invite has no resolved Job (pre-Job-as-root invite) — re-send the welcome:', invite.id)
    return landing
  }
  const resolvedJob = await prisma.job.findUnique({
    where: { id: invite.jobId },
    select: { id: true, companyId: true },
  })
  if (!resolvedJob) {
    console.error('[welcome/start] resolved Job missing:', invite.jobId)
    return landing
  }
  // Inquiry already converted by another path (e.g. Convert to quote after
  // the email went out) — attach the click to that job's first order.
  if (inquiry.convertedJobId) {
    const existingOrder = await prisma.order.findFirst({
      where: { jobId: inquiry.convertedJobId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    if (existingOrder) {
      await prisma.welcomeInvite.update({
        where: { id: invite.id },
        data: { usedAt: new Date(), createdJobId: inquiry.convertedJobId, createdOrderId: existingOrder.id },
      })
      return resolveToExisting(existingOrder.id)
    }
    return landing
  }

  // ── Atomic claim: exactly ONE request wins the mint. ──
  const claimed = await prisma.welcomeInvite.updateMany({
    where: { id: invite.id, usedAt: null },
    data: { usedAt: new Date() },
  })
  if (claimed.count === 0) {
    // Concurrent click lost the race — wait for the winner's stamp, then
    // resolve into the same portal.
    for (let i = 0; i < 10; i++) {
      const again = await prisma.welcomeInvite.findUnique({
        where: { id: invite.id },
        select: { createdOrderId: true },
      })
      if (again?.createdOrderId) return resolveToExisting(again.createdOrderId)
      await new Promise((r) => setTimeout(r, 300))
    }
    return landing
  }

  // ── The mint — Order + conversion + stamp, one transaction. The Job
  //    already exists (agent-resolved at send); no Job is created here. ──
  let orderId: string
  let portalSlug: string
  try {
    const minted = await prisma.$transaction(async (tx) => {
      // A NEW lead with a portal + Order underway is a quoted job now.
      await tx.job.updateMany({ where: { id: resolvedJob.id, status: 'NEW' }, data: { status: 'QUOTED' } })
      const orderNumber = await nextOrderNumber(tx)
      const order = await tx.order.create({
        data: {
          orderNumber,
          // The Job is the root object — the Order follows ITS company
          // (the agent may have attached this inquiry to a Job under a
          // different company than the inquiry's original guess).
          companyId: resolvedJob.companyId,
          agentId: inquiry.assignedToId!,
          jobId: resolvedJob.id,
          taxRate: 0,
          startDate: inquiry.preferredStartDate,
          endDate: inquiry.preferredEndDate,
        },
        select: { id: true, portalSlug: true },
      })
      // Inquiry.convertedJobId is @unique — when the agent attached this
      // inquiry to a Job that ALREADY converted another inquiry (the
      // duplicate-shoot case), mark CONVERTED without the link.
      const linkHolder = await tx.inquiry.findFirst({
        where: { convertedJobId: resolvedJob.id, NOT: { id: inquiry.id } },
        select: { id: true },
      })
      await tx.inquiry.update({
        where: { id: inquiry.id },
        data: linkHolder ? { status: 'CONVERTED' } : { status: 'CONVERTED', convertedJobId: resolvedJob.id },
      })
      await tx.welcomeInvite.update({
        where: { id: invite.id },
        data: { createdJobId: resolvedJob.id, createdOrderId: order.id },
      })
      return { orderId: order.id, portalSlug: order.portalSlug }
    })
    orderId = minted.orderId
    portalSlug = minted.portalSlug ?? ''
  } catch (err) {
    // Mint failed — release the claim so a retry click can mint.
    console.error('[welcome/start] mint failed:', invite.id, err)
    await prisma.welcomeInvite
      .updateMany({ where: { id: invite.id, createdJobId: null }, data: { usedAt: null } })
      .catch(() => {})
    return landing
  }

  // Paperwork ready — same baseline path the portal/send-paperwork use.
  // Best-effort: a render hiccup never blocks the client's landing.
  try {
    await ensureSignedAgreementForOrder(orderId)
    await ensureBaselineRentalDocumentToSign(orderId)
    await prisma.signedAgreement.updateMany({
      where: { orderId, contractType: 'RENTAL_AGREEMENT', status: 'PORTAL_GENERATED', documentToSignUrl: { not: null } },
      data: { status: 'PORTAL_RELEASED' },
    })
  } catch (err) {
    console.error('[welcome/start] paperwork prep failed (non-blocking):', orderId, err)
  }

  if (!portalSlug) return landing
  const issued = await issueJobMagicLink({ orderId, contactId: invite.personId })
  return { kind: 'redirect', url: portalJobUrl(portalSlug, issued.token) }
}
