/**
 * Pure (no-side-effect) composer for the Mode A follow-up email.
 *
 * Mirrors composeQuoteEmail's shape: recipient ranking + cadence
 * gating + body render in one place; preview and send both call it.
 * The send route adds: magic-link mint, Resend dispatch, QuoteFollowUp
 * row write. Composer never writes.
 *
 * Cadence gating is reported in the result rather than thrown — the
 * preview UI surfaces "this send would be blocked because <reason>"
 * before the agent commits, instead of opening the modal only to see
 * a 409 on Send-click.
 */

import { prisma } from '@/lib/prisma'
import { rankRecipients, type RankedRecipient } from '@/lib/email/recipients'
import { buildFollowUpSendEmail } from '@/lib/email/templates/followUpSend'
import { SEND_FROM } from '@/lib/email/sendAgreementEmail'
import {
  CADENCE_STAGES,
  computeCadenceState,
  type CadenceStage,
} from '@/lib/sales/quoteCadence'

export interface FollowUpEmailCompositionOk {
  ok: true
  to: RankedRecipient
  alternatives: RankedRecipient[]
  from: string
  subject: string
  html: string
  text: string
  attachments: [] // never any
  stage: CadenceStage
  /** True when the agent has already sent this stage. The send route
   *  accepts these as no-write resends; the modal shows a "resend"
   *  indicator. */
  isResend: boolean
  order: {
    id: string
    orderNumber: string
    jobName: string | null
    portalSlug: string | null
    validUntil: Date | null
  }
  portalUrlIsTokenized: boolean
}

export type FollowUpEmailComposition =
  | FollowUpEmailCompositionOk
  | { ok: false; status: number; error: string }

export interface ComposeFollowUpEmailArgs {
  orderId: string
  /** Optional explicit stage. When omitted, resolves to currentDueStage
   *  or the first unsent CADENCE_STAGE. */
  stage?: CadenceStage | null
  message?: string | null
  /** Pass null for preview (omit portal button). Pass tokenized URL
   *  for send. */
  portalUrl: string | null
  /** Person.id override. Same validation as composeQuoteEmail —
   *  must be one of the ranked candidates on this order. */
  overrideContactId?: string | null
}

export async function composeFollowUpEmail(
  args: ComposeFollowUpEmailArgs,
): Promise<FollowUpEmailComposition> {
  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      quoteSentAt: true,
      expiresAt: true,
      quoteExpDays: true,
      portalSlug: true,
      companyId: true,
      agent: { select: { name: true, email: true } },
      job: {
        select: {
          name: true,
          jobContacts: {
            select: {
              role: true,
              isPrimary: true,
              person: {
                select: { id: true, firstName: true, lastName: true, email: true },
              },
            },
          },
        },
      },
      jobContact: { select: { id: true, firstName: true, lastName: true, email: true } },
      followUps: { select: { stage: true, status: true } },
    },
  })
  if (!order) return { ok: false, status: 404, error: 'order not found' }
  if (!order.quoteSentAt) {
    return {
      ok: false,
      status: 400,
      error: 'order has no quote-sent timestamp — cadence not started',
    }
  }

  // Latest inbound on this client's mail for gating.
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
    (f) =>
      f.status === 'SENT' && (f.stage === 'DAY_0' || f.stage === 'DAY_1' || f.stage === 'DAY_3'),
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

  // Resolve stage — explicit wins; else currentDueStage; else first unsent.
  const resolvedStage: CadenceStage = (() => {
    if (args.stage) return args.stage
    if (state.currentDueStage) return state.currentDueStage
    const firstUnsent = CADENCE_STAGES.find((s) => !stagesSent.includes(s))
    return firstUnsent ?? CADENCE_STAGES[0]
  })()

  const isResend = stagesSent.includes(resolvedStage)

  // Paused? Block — but resends of an already-SENT stage are allowed.
  if (state.paused && !isResend) {
    return { ok: false, status: 409, error: `cadence paused — ${state.pauseReason ?? 'unknown'}` }
  }
  // Out-of-order? Block.
  if (!isResend) {
    const idx = CADENCE_STAGES.indexOf(resolvedStage)
    for (let i = 0; i < idx; i++) {
      if (!stagesSent.includes(CADENCE_STAGES[i])) {
        return {
          ok: false,
          status: 409,
          error: `${CADENCE_STAGES[i]} hasn't been sent yet — send earlier stages first`,
        }
      }
    }
  }

  const ranked = rankRecipients(order.job, order.jobContact)
  if (ranked.length === 0) {
    return { ok: false, status: 400, error: 'no recipient — add a contact to the job first' }
  }
  // Optional override — must be one of the ranked candidates.
  let to = ranked[0]
  let alternatives = ranked.slice(1)
  if (args.overrideContactId) {
    const idx = ranked.findIndex((r) => r.id === args.overrideContactId)
    if (idx < 0) {
      return { ok: false, status: 400, error: 'override contact is not on this order' }
    }
    to = ranked[idx]
    alternatives = ranked.filter((_, i) => i !== idx)
  }

  const { subject, html, text } = buildFollowUpSendEmail({
    stage: resolvedStage,
    firstName: to.name.split(' ')[0] || 'there',
    orderNumber: order.orderNumber,
    jobName: order.job?.name ?? 'your production',
    agentName: order.agent.name || 'SirReel',
    agentEmail: order.agent.email,
    validUntil: state.effectiveExpiresAt,
    portalUrl: args.portalUrl,
    customMessage: args.message ?? null,
  })

  return {
    ok: true,
    to,
    alternatives,
    from: SEND_FROM,
    subject,
    html,
    text,
    attachments: [],
    stage: resolvedStage,
    isResend,
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      jobName: order.job?.name ?? null,
      portalSlug: order.portalSlug,
      validUntil: state.effectiveExpiresAt,
    },
    portalUrlIsTokenized: args.portalUrl != null && args.portalUrl.includes('?token='),
  }
}
