/**
 * POST /api/orders/[id]/follow-ups/send — Mode A agent-driven follow-up.
 *
 * Composes the branded follow-up email for the chosen stage, sends it to
 * the order's canonical recipient via Resend (sendAgreementEmail wrapper),
 * then logs a QuoteFollowUp row with status=SENT so the cadence helper
 * counts the stage as fired and the panel advances.
 *
 * Body: { stage: 'STAGE_1' | 'STAGE_2' | 'STAGE_3', message?: string }
 *
 * Refuses when:
 *   - the order has no quoteSentAt (cadence not started)
 *   - the cadence is paused (client_replied / status_advanced / all_sent)
 *   - the order has no contact to email
 *
 * Resends of an already-SENT stage are allowed via { resend: true } —
 * the email goes out again but the existing QuoteFollowUp row is
 * preserved (no second row written).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { buildFollowUpSendEmail } from '@/lib/email/templates/followUpSend'
import {
  CADENCE_STAGES,
  computeCadenceState,
  type CadenceStage,
} from '@/lib/sales/quoteCadence'
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
  /** Preview-only: run resolution + all gating, but skip the actual
   *  Resend call and the QuoteFollowUp write. Returns the would-be
   *  recipient, stage, and order so the confirm dialog can render
   *  who/what before the agent commits. */
  dryRun?: unknown
}

interface Recipient {
  id: string
  name: string
  email: string
  role: string | null
  isPrimary: boolean
}

function rankRecipients(
  jobContacts: {
    role: string
    isPrimary: boolean
    person: { id: string; firstName: string; lastName: string; email: string }
  }[],
  jobContact: { id: string; firstName: string; lastName: string; email: string } | null,
): Recipient[] {
  const all: Recipient[] = []
  const seen = new Set<string>()
  const push = (id: string, name: string, email: string, role: string | null, isPrimary: boolean) => {
    if (!id || !email || seen.has(id)) return
    seen.add(id)
    all.push({ id, name, email, role, isPrimary })
  }
  for (const jc of jobContacts) {
    push(
      jc.person.id,
      `${jc.person.firstName} ${jc.person.lastName}`.trim(),
      jc.person.email,
      jc.role,
      !!jc.isPrimary,
    )
  }
  if (jobContact) {
    push(jobContact.id, `${jobContact.firstName} ${jobContact.lastName}`.trim(), jobContact.email, null, false)
  }
  const rank = (r: Recipient): number => {
    if (r.role === 'PRODUCER') return 0
    if (r.isPrimary) return 1
    if (r.role === 'PM') return 2
    if (r.role === 'PC') return 3
    if (r.role) return 4
    return 5
  }
  all.sort((a, b) => rank(a) - rank(b))
  return all
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return bad(401, 'unauthorized')

  const body = (await req.json().catch(() => ({}))) as SendBody
  // `stage` is OPTIONAL. The legacy pipeline surfaces (FollowUpsDuePanel,
  // OpenQuotesKanban) don't know a STAGE_N — they just want "send the
  // appropriate next nudge". When omitted, we resolve server-side below
  // after we've loaded the order + computed cadence state. The Mode A
  // panel on the order detail page still passes an explicit stage.
  const explicitStage = body.stage
  if (
    explicitStage != null &&
    (typeof explicitStage !== 'string' ||
      !CADENCE_STAGES.includes(explicitStage as CadenceStage))
  ) {
    return bad(400, 'stage must be STAGE_1, STAGE_2, or STAGE_3 (or omitted for auto-resolve)')
  }
  const message =
    typeof body.message === 'string' && body.message.trim().length > 0
      ? body.message.trim().slice(0, 5000)
      : null
  const isResend = body.resend === true
  const isDryRun = body.dryRun === true

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      quoteSentAt: true,
      expiresAt: true,
      quoteExpDays: true,
      portalSlug: true,
      companyId: true,
      agent: { select: { id: true, name: true, email: true } },
      job: {
        select: {
          name: true,
          jobContacts: {
            select: {
              role: true,
              isPrimary: true,
              person: { select: { id: true, firstName: true, lastName: true, email: true } },
            },
          },
        },
      },
      jobContact: { select: { id: true, firstName: true, lastName: true, email: true } },
      followUps: {
        select: { id: true, stage: true, status: true, sentAt: true },
      },
    },
  })
  if (!order) return bad(404, 'order not found')
  if (!order.quoteSentAt) return bad(400, 'order has no quote-sent timestamp — cadence not started')

  // Pull last inbound for gating.
  let threadLastInboundAt: Date | null = null
  if (order.companyId) {
    const latestInbound = await prisma.emailMessage.findFirst({
      where: {
        companyId: order.companyId,
        direction: 'inbound',
        sentAt: { gt: order.quoteSentAt },
      },
      orderBy: { sentAt: 'desc' },
      select: { sentAt: true },
    })
    threadLastInboundAt = latestInbound?.sentAt ?? null
  }

  const stagesSent: CadenceStage[] = order.followUps
    .filter((f) => f.status === 'SENT' && CADENCE_STAGES.includes(f.stage as CadenceStage))
    .map((f) => f.stage as CadenceStage)

  const legacySentExists = order.followUps.some(
    (f) => f.status === 'SENT' && (f.stage === 'DAY_0' || f.stage === 'DAY_1' || f.stage === 'DAY_3'),
  )

  const state = computeCadenceState({
    quoteSentAt: order.quoteSentAt,
    expiresAt: order.expiresAt,
    quoteExpDays: order.quoteExpDays,
    status: order.status,
    threadLastInboundAt,
    stagesSent,
    legacySentExists,
  })

  // Resolve auto-stage when caller didn't specify one. Preference order:
  //   1. currentDueStage  — the stage the cadence helper thinks is "due"
  //   2. first unsent CADENCE_STAGE — for ad-hoc nudges where the
  //      cadence isn't yet pointing at anything (e.g. STAGE_1 before
  //      its 2-day timer). Agent override of the timer.
  // If everything's already sent, the paused check below catches it
  // (state.pauseReason = 'all_stages_sent').
  const stageEnum: CadenceStage = (() => {
    if (explicitStage) return explicitStage as CadenceStage
    if (state.currentDueStage) return state.currentDueStage
    const firstUnsent = CADENCE_STAGES.find((s) => !stagesSent.includes(s))
    // Fallback to STAGE_1 when nothing resolves; the gating checks below
    // will refuse if the order is paused/over.
    return firstUnsent ?? CADENCE_STAGES[0]
  })()

  // Block sends when paused (unless explicit resend on an already-SENT stage).
  if (state.paused && !(isResend && stagesSent.includes(stageEnum))) {
    return bad(409, `cadence paused — ${state.pauseReason ?? 'unknown'}`)
  }
  // Block sending a stage out of order — STAGE_2 only after STAGE_1 sent, etc.
  if (!stagesSent.includes(stageEnum)) {
    const idx = CADENCE_STAGES.indexOf(stageEnum)
    for (let i = 0; i < idx; i++) {
      if (!stagesSent.includes(CADENCE_STAGES[i])) {
        return bad(409, `${CADENCE_STAGES[i]} hasn't been sent yet — send earlier stages first`)
      }
    }
  }

  const ranked = rankRecipients(order.job?.jobContacts ?? [], order.jobContact)
  const primary = ranked[0]
  if (!primary) return bad(400, 'no recipient — add a contact to the job first')

  // Dry-run exits here. All resolution + gating ran (so callers see
  // the same 4xx errors they'd see on a real send); we just skip the
  // Resend dispatch and the QuoteFollowUp write.
  if (isDryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      stage: stageEnum,
      recipient: { email: primary.email, name: primary.name, role: primary.role },
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        jobName: order.job?.name ?? null,
        validUntil: state.effectiveExpiresAt,
      },
      isResend: stagesSent.includes(stageEnum),
    })
  }

  // Refresh-or-issue the portal magic-link so the CTA self-bootstraps
  // first-visit auth. Strict one-row-per-(order, contact) policy — see
  // refreshOrIssueJobMagicLink. Dry-run already exited above; this runs
  // only on the real-send path so a "Send?" preview doesn't refresh
  // an expiresAt or mint a row.
  let portalUrl: string | null = null
  if (order.portalSlug) {
    try {
      const link = await refreshOrIssueJobMagicLink({ orderId: order.id, contactId: primary.id })
      portalUrl = `${PORTAL_HOST}/portal/job/${order.portalSlug}?token=${encodeURIComponent(link.token)}`
    } catch (err) {
      console.warn('[follow-up send] portal-link mint failed:', err)
    }
  }

  const { subject, html, text } = buildFollowUpSendEmail({
    stage: stageEnum,
    firstName: primary.name.split(' ')[0] || 'there',
    orderNumber: order.orderNumber,
    jobName: order.job?.name ?? 'your production',
    agentName: order.agent.name || 'SirReel',
    agentEmail: order.agent.email,
    validUntil: state.effectiveExpiresAt,
    portalUrl,
    customMessage: message,
  })

  const result = await sendAgreementEmail({
    to: [primary.email],
    subject,
    html,
    text,
    label: `follow-up:${stageEnum}:${order.orderNumber}`,
  })
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: `email send failed: ${result.reason}`, emailResult: result },
      { status: 502 },
    )
  }

  // Log / advance — write-once. Resends don't double-log.
  const existing = order.followUps.find((f) => f.stage === stageEnum)
  if (!existing) {
    const userRow = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    })
    await prisma.quoteFollowUp.create({
      data: {
        orderId: order.id,
        stage: stageEnum,
        // dueAt = the cadence-computed time the stage came due. Recording it
        // for the audit trail so the row is interpretable later even after
        // we drift the cadence math.
        dueAt: state.dueDates[stageEnum],
        status: 'SENT',
        draftSubject: subject,
        draftBody: text,
        sentAt: new Date(),
        sentById: userRow?.id ?? null,
      },
    })
  } else if (existing.status !== 'SENT') {
    const userRow = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    })
    await prisma.quoteFollowUp.update({
      where: { id: existing.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        sentById: userRow?.id ?? null,
        draftSubject: subject,
        draftBody: text,
      },
    })
  }

  return NextResponse.json({
    ok: true,
    emailId: result.id,
    stage: stageEnum,
    recipient: { email: primary.email, name: primary.name },
    isResend,
  })
}
