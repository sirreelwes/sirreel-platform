/**
 * Who is on this conversation — the address list a staff reply composed
 * from the Job page starts with.
 *
 * Wes 2026-09-09: "We should be able to populate an email from here that
 * cc's whomever was on the thread's latest email." The button only earns
 * its place if it reproduces what Reply-All in Gmail would have done;
 * anything less and the trip back to the inbox it replaces was safer.
 *
 * Reading takes three fields, because no single one is complete:
 *   · fromAddress   — always set; the author.
 *   · toAddresses[] — set on every row, and the ONLY recipient record on
 *                     synthesized outbound rows (Quick Reply and this
 *                     composer never pass through Gmail).
 *   · routingHeaders.to / .cc — the raw RFC-5322 lists captured at ingest
 *                     (display-name form, already lower-cased). The only
 *                     place a Cc survives at all.
 *
 * Our own @sirreel.com addresses come back SEPARATELY and are never folded
 * into the client list — the same rule parseInboundCc has always applied,
 * for the same reason: the team's copy is the sales-desk CC channel's job
 * (lib/email/teamVisibility), and echoing dani@ back at a client makes an
 * internal address look like their contact.
 */

import { extractAddresses, isInternalAddress } from '@/lib/email/inboundCc'
import { parseEmailAddress } from '@/lib/email/direction'
import { isEmailAddress } from '@/lib/email/ccList'

/** The shape this reads — a subset of EmailMessage, so callers select narrow. */
export interface ParticipantMessage {
  id: string
  fromAddress: string
  toAddresses: string[]
  direction: string
  sentAt: Date | string
  routingHeaders: unknown
}

export interface ThreadParticipants {
  /** Best default recipient: whoever last wrote TO us. Null on a thread
   *  we have only ever talked into (the caller falls back to the job's
   *  primary contact). */
  to: string | null
  /** Everyone else on the latest message, client-side, in header order. */
  cc: string[]
  /** Our own people who were on it — shown to the agent, never CC'd. */
  internal: string[]
  /** The message the lists were read off, for the "as of" line in the UI. */
  sourceMessageId: string | null
  sourceSentAt: string | null
}

const EMPTY: ThreadParticipants = {
  to: null,
  cc: [],
  internal: [],
  sourceMessageId: null,
  sourceSentAt: null,
}

function ms(v: Date | string): number {
  return v instanceof Date ? v.getTime() : new Date(v).getTime()
}

function routing(msg: ParticipantMessage): { to?: string; cc?: string } {
  const r = msg.routingHeaders
  return r && typeof r === 'object' ? (r as { to?: string; cc?: string }) : {}
}

/**
 * Every address that appeared on one message — author first, then To:,
 * then Cc:, deduped in that order.
 *
 * Every candidate is validated, not just cleaned. `toAddresses` is the
 * untrustworthy one: the ingest splits the raw header on commas, so a
 * quoted display name lands as junk beside the real address — Fox
 * Sports' thread stores `"proval` next to `marc.proval@fox.com`. One
 * malformed recipient makes Resend reject the entire send, so a token
 * that isn't an address is dropped here rather than carried to the CC
 * line (see isEmailAddress in lib/email/ccList).
 */
function addressesOn(msg: ParticipantMessage): string[] {
  const h = routing(msg)
  const seen = new Set<string>()
  const out: string[] = []
  const push = (raw: string | null | undefined) => {
    const addr = (raw ?? '').trim().toLowerCase()
    if (!addr || seen.has(addr) || !isEmailAddress(addr)) return
    seen.add(addr)
    out.push(addr)
  }
  push(parseEmailAddress(msg.fromAddress))
  for (const a of extractAddresses(h.to)) push(a)
  for (const a of msg.toAddresses ?? []) push(parseEmailAddress(a))
  for (const a of extractAddresses(h.cc)) push(a)
  return out
}

/**
 * Build the reply's address lists from a thread's messages (any order).
 *
 * The CC set comes off the LATEST message — that is the current shape of
 * the conversation, and someone added three messages ago who has since
 * dropped off should not be re-added by us.
 *
 * The To: is deliberately read off a different message: the latest
 * INBOUND one. On a thread whose last message is our own send, the
 * latest message's author is us, and defaulting To: to ourselves would
 * be useless — the person waiting on an answer is whoever wrote in last.
 */
export function participantsForReply(messages: ParticipantMessage[]): ThreadParticipants {
  if (!messages || messages.length === 0) return EMPTY
  const sorted = [...messages].sort((a, b) => ms(a.sentAt) - ms(b.sentAt))
  const latest = sorted[sorted.length - 1]

  const onLatest = addressesOn(latest)
  const lastInbound = [...sorted]
    .reverse()
    .find((m) => (m.direction || '').toLowerCase() === 'inbound')

  const clients = onLatest.filter((a) => !isInternalAddress(a))
  const internal = onLatest.filter((a) => isInternalAddress(a))

  // Preferred To: the last client who wrote in — but only if they are
  // still on the latest message. Someone who was dropped from the
  // conversation does not get re-addressed by a reply from HQ.
  const inboundAuthor = lastInbound ? parseEmailAddress(lastInbound.fromAddress) : null
  const to =
    inboundAuthor && clients.includes(inboundAuthor)
      ? inboundAuthor
      : clients[0] ?? null

  return {
    to,
    cc: clients.filter((a) => a !== to),
    internal,
    sourceMessageId: latest.id,
    sourceSentAt: (latest.sentAt instanceof Date
      ? latest.sentAt
      : new Date(latest.sentAt)
    ).toISOString(),
  }
}
