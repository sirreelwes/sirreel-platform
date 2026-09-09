/**
 * Who else was on the inbound email.
 *
 * Wes 2026-08-25: "when multiple people are cc'd on an inquiry email, we
 * need all of those clients cc'd on the reply, job etc." Replying to only
 * the sender drops the coordinator, the UPM and whoever else the client
 * deliberately looped in — and they find out about the answer secondhand,
 * or not at all.
 *
 * Gmail ingestion already keeps the raw Cc header on
 * EmailMessage.routingHeaders.cc (43,708 messages have one). It's a raw
 * RFC-5322 list, lower-cased by the extractor, in display-name form:
 *
 *   cara chooljian <cara.chooljian@gmail.com>, dani novoa <dani@sirreel.com>
 *
 * so it has to be parsed rather than used as-is. parseCcList deliberately
 * REJECTS display-name forms — it guards what a rep types — so this is the
 * separate job of reading what a mail client wrote.
 *
 * OUR OWN PEOPLE ARE DROPPED. A thread routinely CCs dani@ or jose@, and
 * echoing them back onto a client-facing reply is noise at best; at worst
 * it makes an internal address look like the client's contact when the
 * list is used to build job contacts.
 */

const ADDRESS_RE = /[^\s@<>,;]+@[^\s@<>,;.]+(?:\.[^\s@<>,;.]+)+/g

/** Our own domain — never CC'd back onto a client reply. */
const INTERNAL_DOMAIN = 'sirreel.com'

export interface InboundCcResult {
  /** Client-side addresses, de-duplicated, in header order. */
  clients: string[]
  /** Our own people who were on the thread — reported, not CC'd. */
  internal: string[]
}

/**
 * Every address in a raw RFC-5322 header list, lower-cased, in header
 * order, deduped. Display-name forms are read through — that's the whole
 * point of this module (see the header note).
 *
 * Exported because the Job-page composer reads To: and Cc: the same way
 * this file has always read Cc: (src/lib/email/threadParticipants.ts).
 */
export function extractAddresses(rawHeader: string | null | undefined): string[] {
  if (!rawHeader || typeof rawHeader !== 'string') return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const match of rawHeader.match(ADDRESS_RE) ?? []) {
    const addr = match.trim().toLowerCase()
    if (!addr || seen.has(addr)) continue
    seen.add(addr)
    out.push(addr)
  }
  return out
}

/** Is this one of our own mailboxes? Never CC'd back onto a client reply. */
export function isInternalAddress(addr: string): boolean {
  return addr.trim().toLowerCase().endsWith(`@${INTERNAL_DOMAIN}`)
}

/**
 * Pull addresses out of a raw Cc header.
 * `exclude` drops anyone already on the reply (the To: recipient).
 */
export function parseInboundCc(
  rawCcHeader: string | null | undefined,
  exclude: Array<string | null | undefined> = [],
): InboundCcResult {
  const out: InboundCcResult = { clients: [], internal: [] }
  if (!rawCcHeader || typeof rawCcHeader !== 'string') return out

  const skip = new Set(
    exclude.filter((e): e is string => !!e).map((e) => e.trim().toLowerCase()),
  )
  for (const addr of extractAddresses(rawCcHeader)) {
    if (skip.has(addr)) continue
    if (isInternalAddress(addr)) out.internal.push(addr)
    else out.clients.push(addr)
  }
  return out
}
