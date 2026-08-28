/**
 * The gate every outreach send must pass.
 *
 * Phase 2 exists so that Phase 3 cannot be built carelessly. This module
 * is the one place that answers "may we send this, from here, to these
 * people, right now" — and it answers no by default.
 *
 * ── The sending-domain rule, which is the whole point ──────────────
 *
 * HQ sends rental agreements, invoices, portal invites and payment links
 * from sirreel.com. That domain's reputation is earned by mail people
 * asked for, and it is why those messages land in the inbox.
 *
 * Cold outreach to auto-captured addresses produces bounces and spam
 * complaints at rates transactional mail never sees. On a shared domain,
 * enough of them and a client stops receiving the agreement they need to
 * sign — days later, with no obvious cause and no error anywhere.
 *
 * So: outreach may only leave from OUTREACH_FROM_DOMAIN, and this guard
 * refuses outright if that resolves to the transactional domain. Wes's
 * ruling (2026-08-26) is that outreach sends from the rep's own address
 * on a warmed subdomain; until that subdomain exists and is set, nothing
 * sends at all. That is the intended state, not a bug.
 *
 * ── Caps ───────────────────────────────────────────────────────────
 *
 * Per-rep and global daily ceilings, counted from EmailDelivery rows
 * labelled as outreach. Caps are the difference between "a campaign went
 * wrong" and "a campaign went wrong 4,000 times before anyone noticed".
 *
 * ── Everything is off by default ───────────────────────────────────
 *
 * OUTREACH_SENDING_ENABLED must be the literal string "true". Read at
 * call time, not module load, so flipping it in Vercel takes effect
 * without a redeploy — same contract as CADENCE_SENDING_ENABLED.
 */

import { prisma } from '@/lib/prisma'
import { filterSuppressed, type SuppressionHit } from '@/lib/outreach/suppression'

/** The transactional domain. Outreach must never send from it. */
export const TRANSACTIONAL_DOMAIN = 'sirreel.com'

/** Label prefix written to EmailDelivery.label by every outreach send. */
export const OUTREACH_LABEL_PREFIX = 'outreach:'

export const DEFAULT_PER_REP_DAILY_CAP = 250
export const DEFAULT_GLOBAL_DAILY_CAP = 1000

export type SendBlockReason =
  | 'sending-disabled'
  | 'no-outreach-domain'
  | 'transactional-domain'
  | 'per-rep-cap'
  | 'global-cap'
  | 'all-recipients-suppressed'

export interface SendGuardInput {
  /** The rep's User.id — caps are per rep. */
  userId: string
  /** Address the batch would send FROM. */
  fromAddress: string
  /** Intended recipients, pre-suppression. */
  recipients: string[]
}

export interface SendGuardResult {
  allowed: boolean
  reason?: SendBlockReason
  /** Human-readable, safe to show a rep. */
  message?: string
  /** Recipients that survived suppression AND the caps. */
  sendable: string[]
  suppressed: SuppressionHit[]
  /** How many were dropped purely because a cap was reached. */
  trimmedByCap: number
  remainingPerRep: number
  remainingGlobal: number
}

function envFlag(name: string): boolean {
  return process.env[name] === 'true'
}

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

export function outreachDomain(): string | null {
  const d = process.env.OUTREACH_FROM_DOMAIN?.trim().toLowerCase()
  return d || null
}

function domainOf(address: string): string {
  const at = address.lastIndexOf('@')
  return at < 0 ? '' : address.slice(at + 1).trim().toLowerCase()
}

/** Start of today, used for the daily cap windows. */
function startOfToday(now: Date): Date {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Outreach sends today, globally or for one rep.
 *
 * Counted off EmailDelivery.label, which every outreach send stamps via
 * `outreachLabel()` as `outreach:<userId>:<campaign>`. Prefix-matching
 * that is what makes the per-rep cap possible without a separate
 * counter table that could drift from what actually went out.
 */
async function countSentToday(userId: string | null, since: Date): Promise<number> {
  const prefix = userId ? `${OUTREACH_LABEL_PREFIX}${userId}:` : OUTREACH_LABEL_PREFIX
  return prisma.emailDelivery.count({
    where: { sentAt: { gte: since }, label: { startsWith: prefix } },
  })
}

/**
 * Decide whether a batch may go out, and to whom.
 *
 * Returns the trimmed recipient list rather than throwing, so a caller
 * can send to the allowed subset and TELL the rep what was held back —
 * silently dropping recipients is how people lose trust in a tool.
 */
export async function sendGuard(input: SendGuardInput, now: Date = new Date()): Promise<SendGuardResult> {
  const empty = { sendable: [] as string[], suppressed: [] as SuppressionHit[], trimmedByCap: 0 }

  if (!envFlag('OUTREACH_SENDING_ENABLED')) {
    return {
      allowed: false,
      reason: 'sending-disabled',
      message:
        'Outreach sending is switched off. Set OUTREACH_SENDING_ENABLED=true once the sending domain is warmed.',
      ...empty,
      remainingPerRep: 0,
      remainingGlobal: 0,
    }
  }

  const domain = outreachDomain()
  if (!domain) {
    return {
      allowed: false,
      reason: 'no-outreach-domain',
      message:
        'No OUTREACH_FROM_DOMAIN is configured. Outreach needs its own warmed subdomain before anything can go out.',
      ...empty,
      remainingPerRep: 0,
      remainingGlobal: 0,
    }
  }

  // The load-bearing check. Refuse even if someone sets the env var to
  // the transactional domain to "just get it working".
  if (domain === TRANSACTIONAL_DOMAIN || domainOf(input.fromAddress) === TRANSACTIONAL_DOMAIN) {
    return {
      allowed: false,
      reason: 'transactional-domain',
      message:
        `Outreach may not send from ${TRANSACTIONAL_DOMAIN}. That domain carries rental agreements and invoices, ` +
        'and outreach bounces would put their delivery at risk. Use the outreach subdomain.',
      ...empty,
      remainingPerRep: 0,
      remainingGlobal: 0,
    }
  }

  const { sendable: afterSuppression, suppressed } = await filterSuppressed(input.recipients)

  const since = startOfToday(now)
  const perRepCap = numEnv('OUTREACH_PER_REP_DAILY_CAP', DEFAULT_PER_REP_DAILY_CAP)
  const globalCap = numEnv('OUTREACH_GLOBAL_DAILY_CAP', DEFAULT_GLOBAL_DAILY_CAP)
  const [sentByRep, sentGlobal] = await Promise.all([
    countSentToday(input.userId, since),
    countSentToday(null, since),
  ])
  const remainingPerRep = Math.max(0, perRepCap - sentByRep)
  const remainingGlobal = Math.max(0, globalCap - sentGlobal)
  const allowance = Math.min(remainingPerRep, remainingGlobal)

  if (afterSuppression.length === 0) {
    return {
      allowed: false,
      reason: 'all-recipients-suppressed',
      message:
        suppressed.length > 0
          ? `All ${suppressed.length} recipients are on the suppression list.`
          : 'No sendable recipients.',
      sendable: [],
      suppressed,
      trimmedByCap: 0,
      remainingPerRep,
      remainingGlobal,
    }
  }

  if (allowance === 0) {
    const which: SendBlockReason = remainingGlobal === 0 ? 'global-cap' : 'per-rep-cap'
    return {
      allowed: false,
      reason: which,
      message:
        which === 'global-cap'
          ? `The daily outreach cap of ${globalCap} across everyone has been reached. Try again tomorrow.`
          : `You have reached your daily outreach cap of ${perRepCap}. Try again tomorrow.`,
      sendable: [],
      suppressed,
      trimmedByCap: afterSuppression.length,
      remainingPerRep,
      remainingGlobal,
    }
  }

  const sendable = afterSuppression.slice(0, allowance)
  return {
    allowed: true,
    sendable,
    suppressed,
    trimmedByCap: afterSuppression.length - sendable.length,
    remainingPerRep,
    remainingGlobal,
  }
}

/** The label an outreach send must write so caps can count it. */
export function outreachLabel(userId: string, campaign: string): string {
  return `${OUTREACH_LABEL_PREFIX}${userId}:${campaign}`
}
