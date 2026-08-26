/**
 * Recipient harvesting — the CC rule.
 *
 * Wes, 2026-08-26: "if contacts are cc'd on a production email from
 * another client, they are worth capturing and classifying as a
 * production contact."
 *
 * The capture pipeline (captureFromEmail.ts) only ever looks at the
 * SENDER. On a film production the To/CC line is the production team —
 * UPM, coordinator, transpo, locations — i.e. exactly the people who
 * book vehicles. Those addresses have been passing through the inboxes
 * unharvested.
 *
 * ── What this module does and does not claim ────────────────────────
 *
 * It harvests addresses off messages the pipeline has ALREADY judged
 * production-legitimate (an InquiryCapture with verdict AUTO_CAPTURED).
 * That judgement is the whole basis for treating a recipient as a
 * production contact — we are not re-deciding legitimacy here, we are
 * inheriting it from the thread.
 *
 * It does NOT infer a job title. A CC line carries a name and an
 * address, never a signature block, so a harvested contact lands with
 * role=OTHER and source='email_cc_capture'. Their role gets filled in
 * later, by a signature on mail they actually send or by the AI pass.
 * Pretending a CC line tells us someone is a UPM would put fiction in
 * the field the sales team targets on.
 *
 * ── The guards, and why each exists ─────────────────────────────────
 *
 *   internal domains  — sirreel.com AND sirreel.us. jp@sirreel.us sat
 *                       on 43 production threads; without this we file
 *                       our own people as client contacts.
 *   role addresses    — locations@, bookings@, info@… are mailboxes,
 *                       not people. locations@capequity.com was the
 *                       most-seen unfiled address at 61 threads.
 *   automated senders — the existing no-reply/bounce localpart list.
 *   vendor domains    — our own suppliers, already enumerated.
 *   thread threshold  — an address seen on ONE thread is usually a
 *                       one-off (a client's accountant, someone's
 *                       personal address, a forward). Two or more
 *                       distinct threads is the difference between a
 *                       coincidence and a working relationship.
 *
 * Freemail addresses are KEPT. A producer on gmail is still a producer;
 * they simply yield no company affiliation.
 */

import {
  HARD_SKIP_SENDER_PATTERNS,
  INTERNAL_DOMAINS,
  KNOWN_VENDOR_DOMAINS,
  ROLE_ADDRESS_LOCALPARTS,
} from './captureConstants'

/** Default minimum distinct production threads before auto-filing. */
export const DEFAULT_THREAD_THRESHOLD = 2

export interface ParsedRecipient {
  email: string
  /** Display name off the header, when the header carried one. */
  name: string | null
}

export type RecipientSkipReason =
  | 'internal'
  | 'role-address'
  | 'automated'
  | 'vendor'
  | 'unparseable'

/**
 * Parse an address header into recipients, preserving display names.
 *
 * Handles the two shapes actually present in the DB:
 *   - EmailMessage.toAddresses — a string[] of bare addresses
 *   - routingHeaders.cc / .to  — one lower-cased string, comma separated,
 *     in "display name <addr@host>" form
 *
 * Quoted display names containing commas ("Doe, Jane" <j@x.com>) are
 * handled by splitting on commas only when outside quotes and angle
 * brackets.
 */
export function parseAddressHeader(value: unknown): ParsedRecipient[] {
  if (!value) return []
  const parts: string[] = []
  const push = (s: string) => { const t = s.trim(); if (t) parts.push(t) }

  if (Array.isArray(value)) {
    for (const v of value) push(String(v))
  } else {
    const s = String(value)
    let buf = ''
    let inQuote = false
    let inAngle = false
    for (const ch of s) {
      if (ch === '"') inQuote = !inQuote
      else if (ch === '<') inAngle = true
      else if (ch === '>') inAngle = false
      if (ch === ',' && !inQuote && !inAngle) { push(buf); buf = ''; continue }
      buf += ch
    }
    push(buf)
  }

  const out: ParsedRecipient[] = []
  for (const part of parts) {
    const angle = part.match(/<([^>]+)>/)
    const email = (angle ? angle[1] : part).trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue
    let name: string | null = null
    if (angle) {
      const raw = part.slice(0, part.indexOf('<')).trim().replace(/^"|"$/g, '').trim()
      // Gmail lower-cases these on write, so "joe russell" comes back
      // flat. Title-case it rather than storing a lower-case name that
      // then appears lower-case in every email we send.
      if (raw && !raw.includes('@')) {
        const cleaned = cleanDisplayName(raw)
        name = cleaned ? titleCase(cleaned) : null
      }
    }
    out.push({ email, name })
  }
  return out
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) =>
      // Leave anything already mixed-case alone (McDonald, DeAngelis)
      // and only fix the all-lower case that Gmail's header gives us.
      w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w,
    )
    .join(' ')
}

/**
 * Clean a raw display name into something a human would want to be
 * addressed as. Every rule here comes from a real value in the
 * 2026-08-26 dry run:
 *
 *   "Uribe, Andrea"                      → "Andrea Uribe"
 *   "Sieun Jung/정시은 (arg_pnv) (hba)"    → "Sieun Jung"
 *   "Beitey, Dustan A."                  → "Dustan A. Beitey"
 *
 * Directory-style "Last, First" is the important one: left alone it
 * mints a contact whose first name is their surname, and the very
 * first mail merge greets them as "Hi Uribe".
 *
 * Returns null when nothing usable survives — the caller drops those
 * rather than filing an "Unknown".
 */
const NAME_SUFFIXES: ReadonlySet<string> = new Set([
  'jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md', 'esq', 'cpa', 'mba',
])

export function cleanDisplayName(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null

  // Drop parenthetical/bracketed tags: team codes, pronouns, org tags.
  s = s.replace(/[([{][^)\]}]*[)\]}]/g, ' ')
  // Keep only the first alternative of a slash-separated alias
  // ("Sieun Jung/정시은"), which is the romanized form in practice.
  if (s.includes('/')) s = s.split('/')[0]
  s = s.replace(/\s+/g, ' ').trim()
  if (!s) return null

  // "Last, First M." → "First M. Last". Only when there is exactly one
  // comma — a string with more commas is a list or a title, not a name.
  // Generational/credential suffixes are NOT a given name, so
  // "Smith, Jr." must not become "Jr. Smith".
  const commaParts = s.split(',')
  if (commaParts.length === 2) {
    const last = commaParts[0].trim()
    const first = commaParts[1].trim()
    if (last && first && !NAME_SUFFIXES.has(first.replace(/\.$/, '').toLowerCase())) {
      s = `${first} ${last}`
    }
  }
  s = s.replace(/\s+/g, ' ').trim()

  // Reject anything that is really an address or has no letters.
  if (!s || s.includes('@') || !/[a-zA-Z\u00C0-\u024F]/.test(s)) return null
  return s
}

/** Why this address must not become a Person, or null when it may. */
export function recipientSkipReason(email: string): RecipientSkipReason | null {
  const at = email.lastIndexOf('@')
  if (at < 1) return 'unparseable'
  const local = email.slice(0, at).toLowerCase()
  const domain = email.slice(at + 1).toLowerCase()
  if (INTERNAL_DOMAINS.has(domain)) return 'internal'
  if (KNOWN_VENDOR_DOMAINS.has(domain)) return 'vendor'
  if (HARD_SKIP_SENDER_PATTERNS.some((p) => local.includes(p))) return 'automated'
  // Strip a +tag before testing the role list so "bookings+la@" is
  // still recognised as the bookings mailbox.
  const base = local.split('+')[0]
  if (ROLE_ADDRESS_LOCALPARTS.has(base)) return 'role-address'
  return null
}

export interface HarvestedRecipient {
  email: string
  /** Best display name seen across all threads (longest wins). */
  name: string | null
  /** Distinct production threads this address appeared on. */
  threadCount: number
  /** Distinct messages — always >= threadCount, useful for reporting. */
  messageCount: number
}

export interface HarvestSource {
  /** Thread id, or the message id when the message has no thread. */
  threadKey: string
  toAddresses: unknown
  cc: unknown
  to: unknown
}

/**
 * Fold a stream of production messages into deduped recipients.
 *
 * Counting is per DISTINCT THREAD, not per message: a single booking
 * thread with 30 replies must not promote its CC list to "seen 30
 * times". That distinction is the entire value of the threshold.
 */
export function harvestRecipients(
  sources: Iterable<HarvestSource>,
): Map<string, HarvestedRecipient> {
  const acc = new Map<string, HarvestedRecipient & { threads: Set<string> }>()

  for (const src of sources) {
    const recipients = [
      ...parseAddressHeader(src.toAddresses),
      ...parseAddressHeader(src.cc),
      ...parseAddressHeader(src.to),
    ]
    // Dedup within the message so a person on both To and CC counts once.
    const perMessage = new Map<string, ParsedRecipient>()
    for (const r of recipients) {
      if (recipientSkipReason(r.email) !== null) continue
      const prior = perMessage.get(r.email)
      // Prefer the entry that carries a display name.
      if (!prior || (!prior.name && r.name)) perMessage.set(r.email, r)
    }

    for (const r of perMessage.values()) {
      let row = acc.get(r.email)
      if (!row) {
        row = { email: r.email, name: r.name, threadCount: 0, messageCount: 0, threads: new Set() }
        acc.set(r.email, row)
      }
      row.messageCount += 1
      row.threads.add(src.threadKey)
      // Longest name wins — "Joe Russell" beats "Joe".
      if (r.name && (!row.name || r.name.length > row.name.length)) row.name = r.name
    }
  }

  const out = new Map<string, HarvestedRecipient>()
  for (const [email, row] of acc) {
    out.set(email, {
      email,
      name: row.name,
      threadCount: row.threads.size,
      messageCount: row.messageCount,
    })
  }
  return out
}

/** Split a harvest into what auto-files and what needs a human. */
export function partitionByConfidence(
  harvested: Iterable<HarvestedRecipient>,
  threshold: number = DEFAULT_THREAD_THRESHOLD,
): { autoFile: HarvestedRecipient[]; review: HarvestedRecipient[] } {
  const autoFile: HarvestedRecipient[] = []
  const review: HarvestedRecipient[] = []
  for (const r of harvested) {
    (r.threadCount >= threshold ? autoFile : review).push(r)
  }
  const byThreads = (a: HarvestedRecipient, b: HarvestedRecipient) => b.threadCount - a.threadCount
  autoFile.sort(byThreads)
  review.sort(byThreads)
  return { autoFile, review }
}
