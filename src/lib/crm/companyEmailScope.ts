/**
 * Which outbound emails belong on a COMPANY's Activity History.
 *
 * Wes 2026-09-19, looking at Party Giraffes: "the activity tile includes
 * stuff that isn't party giraffe Job activity" — the feed carried
 * "Contrast Film | Vevo | Final Invoice" and "OBB x Cybmiotika // Truck",
 * two other productions entirely.
 *
 * /api/crm/companies/[id] derives that feed from a union of three
 * signals (no email row carries a companyId — nothing writes one; see
 * recordOutboundOnThread and the pubsub ingest). Two of the three leak:
 *
 *  1. AN INTERNAL ADDRESS AS A MATCH KEY MATCHES EVERYTHING. The match
 *     set is "every address on every person affiliated with this
 *     company". One @sirreel.com row in there — a Person captured off a
 *     team member's reply, a shared mailbox linked as a contact — and
 *     both remaining signals open all the way up: outbound
 *     `toAddresses` carries the To: AND Cc: headers at ingest, and every
 *     job-thread send Cc's `jobs+<code>@sirreel.com` plus the rentals@
 *     or billing@ team copy, so `hasSome` then matches every client
 *     email HQ has ever sent. The feed stops being this company's and
 *     becomes the 50 most recent outbound messages in the system —
 *     which is what the three unrelated senders in Wes's screenshot look
 *     like. So internal addresses are never match keys here. They are
 *     not evidence of whose conversation this is; they are on every
 *     conversation.
 *
 *  2. A THREAD FILED TO ANOTHER COMPANY'S JOB IS THAT COMPANY'S. A
 *     Person is not scoped to one client (CLAUDE.md: "works with
 *     multiple via JobContact"), so a freelance producer affiliated here
 *     drags in every thread they have ever been on. Since Phase 1
 *     (2026-09-17) the ingest files an anchored thread to its Job by
 *     itself, so `EmailThread.jobId` → `Job.companyId` is a POSITIVE
 *     answer to "whose conversation is this" — and the one signal that
 *     can say no. A contact match never outranks it.
 *
 * The same `jobId` is also what lets the feed be RIGHT in the other
 * direction: a quote or an invoice sent to this company's job belongs
 * here whether or not the recipient happens to be an affiliated Person.
 *
 * UNFILED IS NOT FOREIGN. A thread with no job on it is the ordinary
 * pre-job case (an inquiry, a cold quote) and the contact match is all
 * we have; dropping it would empty the feed for every client who has not
 * reached a job yet. Only a thread filed to a DIFFERENT company's job is
 * excluded.
 *
 * Pure — no prisma. `npm run test:company-activity`.
 */

import { extractAddresses, isInternalAddress } from '@/lib/email/inboundCc'

/** Looks like an address at all — guards a blank or a display name. */
function looksLikeAddress(addr: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)
}

/**
 * The addresses that may be used to claim an email for a company.
 *
 * Lower-cased, trimmed, de-duplicated; blanks, malformed values and
 * every @sirreel.com address dropped (reason 1 above). Order is the
 * order given, so a caller can keep the primary contact first.
 */
export function clientMatchAddresses(
  raw: ReadonlyArray<string | null | undefined>,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of raw) {
    if (!value || typeof value !== 'string') continue
    const addr = value.trim().toLowerCase()
    if (!addr || seen.has(addr)) continue
    if (!looksLikeAddress(addr)) continue
    if (isInternalAddress(addr)) continue
    seen.add(addr)
    out.push(addr)
  }
  return out
}

/**
 * Did this message's From: header carry one of the match addresses?
 *
 * The DB filter has to be `contains` — `fromAddress` is stored in
 * display-name form (`"Ana Ruiz" <ana@client.com>`) — and `contains` is
 * a substring test, so `sam@acme.com` also matches `notsam@acme.com`
 * and `sam@acme.com.br`. This is the exact re-check over the rows that
 * came back.
 */
export function fromAddressMatches(
  fromAddress: string | null | undefined,
  candidates: ReadonlyArray<string>,
): boolean {
  if (!fromAddress) return false
  const wanted = new Set(candidates.map((c) => c.trim().toLowerCase()))
  if (wanted.size === 0) return false
  return extractAddresses(fromAddress).some((a) => wanted.has(a))
}

export interface ScopedEmail {
  /** EmailMessage.threadId — null for a message on no thread. */
  threadId: string | null
  /** EmailMessage.companyId — an explicit match, when one was ever written. */
  companyId?: string | null
}

export interface CompanyEmailScope {
  /** The company whose page this is. */
  companyId: string
  /**
   * threadId → the companyId of the Job that thread is filed to.
   * A thread absent from the map, or mapped to null, is UNFILED.
   */
  threadCompanyId: ReadonlyMap<string, string | null>
}

export type DropReason = 'other-company-job'

/**
 * Why a message is being kept, most authoritative first. Returned rather
 * than a bare boolean so the caller can log which signal claimed a row.
 */
export type KeepReason = 'explicit-company' | 'own-job-thread' | 'contact-match'

export interface ScopeVerdict {
  keep: boolean
  reason: KeepReason | DropReason
}

/** Does one message belong on this company's feed? */
export function scopeEmailToCompany(
  msg: ScopedEmail,
  scope: CompanyEmailScope,
): ScopeVerdict {
  // An explicitly matched row is this company's whatever the thread
  // says — somebody (or something) named the company on the row itself.
  if (msg.companyId && msg.companyId === scope.companyId) {
    return { keep: true, reason: 'explicit-company' }
  }

  const owner = msg.threadId ? scope.threadCompanyId.get(msg.threadId) : undefined
  if (owner) {
    return owner === scope.companyId
      ? { keep: true, reason: 'own-job-thread' }
      : { keep: false, reason: 'other-company-job' }
  }

  // Unfiled thread, or no thread at all: the contact match that put the
  // row in front of us is the only evidence there is, and it stands.
  return { keep: true, reason: 'contact-match' }
}

/** scopeEmailToCompany over a list, order preserved. */
export function scopeEmailsToCompany<T extends ScopedEmail>(
  messages: ReadonlyArray<T>,
  scope: CompanyEmailScope,
): T[] {
  return messages.filter((m) => scopeEmailToCompany(m, scope).keep)
}
