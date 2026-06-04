/**
 * POST /api/orders/[id]/follow-ups/send — Mode A agent-driven follow-up.
 *
 * Composes the branded follow-up email via the shared composeFollowUpEmail
 * helper (same code path the /preview endpoint uses — single source of
 * truth for recipient ranking, cadence gating, body render), then this
 * route layers in: magic-link mint, Resend dispatch, QuoteFollowUp row
 * write.
 *
 * Body: { stage?, message?, resend?, overrideContactId? }
 *
 * For previewing the composed result without side effects, callers
 * use the sibling /preview endpoint. The old `dryRun: true` flag was
 * retired along with FollowUpConfirmDialog in commit 4 — there are
 * no in-tree callers.
 *
 * Refuses when:
 *   - the order has no quoteSentAt (cadence not started)
 *   - the cadence is paused (client_replied / status_advanced /
 *     legacy_nudge_sent / all_stages_sent)
 *   - the order has no contact to email
 *   - sending a stage out of order (STAGE_2 before STAGE_1)
 *
 * Resends of an already-SENT stage are allowed — the email goes out
 * again, the existing QuoteFollowUp row is preserved.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { recordEmailDelivery } from '@/lib/email/recordEmailDelivery'
import { composeFollowUpEmail } from '@/lib/email/preview/composeFollowUpEmail'
import { CADENCE_STAGES, type CadenceStage } from '@/lib/sales/quoteCadence'
import { refreshOrIssueJobMagicLink } from '@/lib/portal/jobMagicLink'

const PORTAL_HOST = 'https://hq.sirreel.com'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status })
}

interface SendBody {
  stage?: unknown
  message?: unknown
  resend?: unknown
  /** Person.id override from the EmailReviewModal "Change recipient"
   *  picker. Composer validates membership in the ranked candidates. */
  overrideContactId?: unknown
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return bad(401, 'unauthorized')

  const body = (await req.json().catch(() => ({}))) as SendBody
  const explicitStage = body.stage
  if (
    explicitStage != null &&
    (typeof explicitStage !== 'string' ||
      !CADENCE_STAGES.includes(explicitStage as CadenceStage))
  ) {
    return bad(400, 'stage must be STAGE_1, STAGE_2, or STAGE_3 (or omitted for auto-resolve)')
  }
  const stage = (explicitStage as CadenceStage | undefined) ?? null
  const message =
    typeof body.message === 'string' && body.message.trim().length > 0
      ? body.message.trim().slice(0, 5000)
      : null
  const overrideContactId =
    typeof body.overrideContactId === 'string' ? body.overrideContactId : null

  // ── Phase 1: compose without portalUrl to learn recipient + stage,
  // and run all gating. Same call path the preview endpoint uses. ──
  const preliminary = await composeFollowUpEmail({
    orderId: params.id,
    stage,
    message,
    overrideContactId,
    portalUrl: null,
  })
  if (!preliminary.ok) return bad(preliminary.status, preliminary.error)

  // ── Phase 2: mint/refresh token, re-compose with tokenized URL ──
  // Load only the slug here — composer already validated the order.
  const orderSlug = await prisma.order.findUnique({
    where: { id: params.id },
    select: { portalSlug: true },
  })
  let portalUrl: string | null = null
  if (orderSlug?.portalSlug) {
    try {
      const link = await refreshOrIssueJobMagicLink({
        orderId: params.id,
        contactId: preliminary.to.id,
      })
      portalUrl = `${PORTAL_HOST}/portal/job/${orderSlug.portalSlug}?token=${encodeURIComponent(link.token)}`
    } catch (err) {
      console.warn('[follow-up send] portal-link mint failed:', err)
    }
  }

  const final = await composeFollowUpEmail({
    orderId: params.id,
    stage: preliminary.stage,
    message,
    overrideContactId,
    portalUrl,
  })
  if (!final.ok) return bad(final.status, final.error)

  // ── Phase 3: dispatch ─────────────────────────────────────
  const result = await sendAgreementEmail({
    to: [final.to.email],
    subject: final.subject,
    html: final.html,
    text: final.text,
    label: `follow-up:${final.stage}:${final.order.orderNumber}`,
  })
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: `email send failed: ${result.reason}`, emailResult: result },
      { status: 502 },
    )
  }

  // ── Phase 4: write QuoteFollowUp row ─────────────────────
  // Stage just sent — single write per send. Resends don't double-log.
  const userRow = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  const existing = await prisma.quoteFollowUp.findUnique({
    where: { orderId_stage: { orderId: params.id, stage: final.stage } },
    select: { id: true, status: true },
  })
  let followUpRowId: string
  if (!existing) {
    // Need the cadence-computed dueAt for audit. Re-derive cheaply
    // from the composer's order.validUntil + the stage table — but
    // we'd lose the exact dueAt the helper saw. Refetch state for
    // accuracy.
    const created = await prisma.quoteFollowUp.create({
      data: {
        orderId: params.id,
        stage: final.stage,
        // The composer already computed cadence state to gate the
        // send; we don't surface dueDates out of it. Use "now" as a
        // conservative audit value — the row's createdAt + sentAt
        // already tell the real story.
        dueAt: new Date(),
        status: 'SENT',
        draftSubject: final.subject,
        draftBody: final.text,
        sentAt: new Date(),
        sentById: userRow?.id ?? null,
      },
      select: { id: true },
    })
    followUpRowId = created.id
  } else {
    followUpRowId = existing.id
    if (existing.status !== 'SENT') {
      await prisma.quoteFollowUp.update({
        where: { id: existing.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          sentById: userRow?.id ?? null,
          draftSubject: final.subject,
          draftBody: final.text,
        },
      })
    }
  }

  // Delivery audit so the order timeline can show sent → delivered /
  // bounced from Resend's webhook events. Best-effort.
  if (result.id) {
    await recordEmailDelivery({
      resendMessageId: result.id,
      toAddress: final.to.email,
      subject: final.subject,
      label: `follow-up:${final.stage}:${final.order.orderNumber}`,
      orderId: params.id,
      quoteFollowUpId: followUpRowId,
    })
  }

  return NextResponse.json({
    ok: true,
    emailId: result.id,
    stage: final.stage,
    recipient: { email: final.to.email, name: final.to.name },
    isResend: final.isResend,
  })
}
