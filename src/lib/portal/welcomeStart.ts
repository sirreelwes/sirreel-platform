import { prisma } from '@/lib/prisma'
import { nextJobCode } from '@/lib/jobs/nextJobCode'
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
 * FIRST click, one transaction: atomically claim the invite → create Job from
 * the Inquiry → create Order (DRAFT; portalSlug auto-mints — the portal
 * container) → Inquiry CONVERTED + convertedJobId → stamp the invite. After
 * the tx (best-effort): baseline agreement generated + released, then a fresh
 * magic link into the job portal.
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
  if (!inquiry.companyId || !inquiry.assignedToId) {
    // Should not happen (the send route enforces + pins these).
    console.error('[welcome/start] inquiry missing company/agent:', inquiry.id)
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

  // ── The mint — Job + Order + conversion + stamp, one transaction. ──
  let orderId: string
  let portalSlug: string
  try {
    const minted = await prisma.$transaction(async (tx) => {
      const jobCode = await nextJobCode(tx)
      const job = await tx.job.create({
        data: {
          jobCode,
          name: inquiry.title,
          companyId: inquiry.companyId!,
          agentId: inquiry.assignedToId!,
          status: 'QUOTED',
          startDate: inquiry.preferredStartDate,
          endDate: inquiry.preferredEndDate,
          estimatedValue: inquiry.estimatedValue,
          // inquiry linkage lives on Inquiry.convertedJobId (set below).
        },
        select: { id: true },
      })
      const orderNumber = await nextOrderNumber(tx)
      const order = await tx.order.create({
        data: {
          orderNumber,
          companyId: inquiry.companyId!,
          agentId: inquiry.assignedToId!,
          jobId: job.id,
          taxRate: 0,
          startDate: inquiry.preferredStartDate,
          endDate: inquiry.preferredEndDate,
        },
        select: { id: true, portalSlug: true },
      })
      await tx.inquiry.update({
        where: { id: inquiry.id },
        data: { status: 'CONVERTED', convertedJobId: job.id },
      })
      await tx.welcomeInvite.update({
        where: { id: invite.id },
        data: { createdJobId: job.id, createdOrderId: order.id },
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
