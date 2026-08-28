/**
 * The suppression list — every outreach send has to pass through here.
 *
 * Phase 2 of the outreach build. Nothing in Phase 3 may reach Resend
 * without calling `filterSuppressed` (or `sendGuard`, which calls it).
 *
 * ── The rules, and why each is absolute ────────────────────────────
 *
 * NORMALIZE ON EVERY WRITE AND READ. Postgres unique indexes are
 * case-sensitive. An un-normalized "Wes@sirreel.com" would slip clean
 * past a suppression stored as "wes@sirreel.com" — the same bug class
 * that once minted duplicate Person rows (src/lib/people/email.ts).
 *
 * FAIL CLOSED. If the suppression lookup throws, `filterSuppressed`
 * suppresses EVERYTHING rather than letting the batch through. A
 * database blip must not become a mailing to people who unsubscribed.
 * This is the opposite of the convention elsewhere in this codebase,
 * where best-effort helpers swallow and continue — because here the
 * failure mode is a CAN-SPAM violation and a burned domain, not a
 * missing audit row.
 *
 * NOTHING EXPIRES. A suppression has no TTL. Letting an address back in
 * is a deliberate, attributed act (`releaseSuppression`), and the row is
 * kept afterwards so the decision stays on the record.
 *
 * UPSERT, NEVER DUPLICATE. Re-suppressing an already-suppressed address
 * updates the reason if the new one is stronger (a complaint outranks a
 * bounce outranks an unsubscribe) and otherwise leaves it alone. A
 * COMPLAINED row must never be downgraded to UNSUBSCRIBED by a later
 * event.
 */

import { prisma } from '@/lib/prisma'
import { SuppressionReason } from '@prisma/client'

/** Lowercase + trim. The only accepted form of an address in this table. */
export function normalizeSuppressionEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Severity order, used so a later, weaker event cannot overwrite a
 * stronger one. A spam complaint is the most expensive signal a mailbox
 * provider gives us; it outranks everything.
 */
const SEVERITY: Record<SuppressionReason, number> = {
  UNSUBSCRIBED: 1,
  MANUAL: 2,
  BOUNCED: 3,
  COMPLAINED: 4,
}

export interface SuppressInput {
  email: string
  reason: SuppressionReason
  detail?: string | null
  /** 'resend-webhook' | 'portal' | `staff:${email}` | 'import' */
  source?: string | null
  personId?: string | null
}

/**
 * Add (or strengthen) a suppression. Idempotent.
 *
 * Re-suppressing an address that a human previously RELEASED re-arms it
 * — a fresh bounce or complaint after a release is new evidence, not a
 * duplicate of the old one, so releasedAt is cleared.
 */
export async function suppressEmail(input: SuppressInput): Promise<{ id: string; created: boolean }> {
  const email = normalizeSuppressionEmail(input.email)
  const existing = await prisma.emailSuppression.findUnique({
    where: { email },
    select: { id: true, reason: true, releasedAt: true },
  })

  if (!existing) {
    const row = await prisma.emailSuppression.create({
      data: {
        email,
        reason: input.reason,
        detail: input.detail ?? null,
        source: input.source ?? null,
        personId: input.personId ?? null,
      },
      select: { id: true },
    })
    return { id: row.id, created: true }
  }

  const strongerReason =
    SEVERITY[input.reason] > SEVERITY[existing.reason] ? input.reason : existing.reason

  await prisma.emailSuppression.update({
    where: { email },
    data: {
      reason: strongerReason,
      // Only overwrite detail/source when this event is the one that
      // set the (possibly new) reason — otherwise a weak later event
      // would relabel a complaint with its own text.
      ...(strongerReason === input.reason
        ? { detail: input.detail ?? null, source: input.source ?? null }
        : {}),
      ...(input.personId ? { personId: input.personId } : {}),
      // New evidence after a release re-suppresses.
      ...(existing.releasedAt ? { releasedAt: null, releasedById: null, suppressedAt: new Date() } : {}),
    },
  })
  return { id: existing.id, created: false }
}

/** Let an address back in. Deliberate, attributed, and reversible. */
export async function releaseSuppression(args: {
  email: string
  releasedById: string
  note?: string | null
}): Promise<boolean> {
  const email = normalizeSuppressionEmail(args.email)
  const existing = await prisma.emailSuppression.findUnique({ where: { email }, select: { id: true } })
  if (!existing) return false
  await prisma.emailSuppression.update({
    where: { email },
    data: {
      releasedAt: new Date(),
      releasedById: args.releasedById,
      releaseNote: args.note ?? null,
    },
  })
  return true
}

export interface SuppressionHit {
  email: string
  reason: SuppressionReason
  suppressedAt: Date
}

/**
 * Split a list of addresses into sendable and suppressed.
 *
 * FAILS CLOSED: any error suppresses the whole list. See the header.
 */
export async function filterSuppressed(
  emails: string[],
): Promise<{ sendable: string[]; suppressed: SuppressionHit[]; failedClosed: boolean }> {
  const normalized = Array.from(new Set(emails.map(normalizeSuppressionEmail).filter(Boolean)))
  if (normalized.length === 0) return { sendable: [], suppressed: [], failedClosed: false }

  try {
    const rows = await prisma.emailSuppression.findMany({
      where: { email: { in: normalized }, releasedAt: null },
      select: { email: true, reason: true, suppressedAt: true },
    })
    const blocked = new Map(rows.map((r) => [r.email, r]))
    return {
      sendable: normalized.filter((e) => !blocked.has(e)),
      suppressed: rows,
      failedClosed: false,
    }
  } catch (err) {
    console.error(
      '[suppression] lookup FAILED — suppressing the entire batch rather than risk sending to an opted-out address:',
      err,
    )
    return {
      sendable: [],
      suppressed: normalized.map((email) => ({
        email,
        reason: SuppressionReason.MANUAL,
        suppressedAt: new Date(),
      })),
      failedClosed: true,
    }
  }
}

/** One-address convenience. Fails closed the same way. */
export async function isSuppressed(email: string): Promise<boolean> {
  const { sendable } = await filterSuppressed([email])
  return sendable.length === 0
}
