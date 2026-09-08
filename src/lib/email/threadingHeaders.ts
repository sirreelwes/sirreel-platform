/**
 * RFC 5322 conversation threading for outbound mail.
 *
 * Wes 2026-09-08: "If someone starts a reply from incoming email … can
 * it somehow stay in the same incoming email thread?"
 *
 * It could not. HQ sends through Resend and passed only
 * from/to/cc/replyTo/subject/html/text/attachments — no `In-Reply-To`,
 * no `References`, no `Message-ID`. A mail client has nothing to thread
 * ON, so every reply an agent sent from HQ arrived in the client's inbox
 * as a brand-new conversation sitting next to the one they wrote. Gmail
 * sometimes groups by subject, which hid the problem in testing and does
 * not survive a subject change.
 *
 * Three headers fix it, and they have to travel together:
 *
 *   In-Reply-To  the Message-ID of the message being answered.
 *   References   the parent's References PLUS the parent's Message-ID —
 *                the whole ancestor chain (RFC 5322 §3.6.4). This is
 *                what lets a client thread a message whose immediate
 *                parent it never saw.
 *   Message-ID   OURS, minted here rather than left to Resend.
 *
 * Why mint our own Message-ID. It is not for the client — it is so the
 * NEXT hop is provable. When the client replies, their In-Reply-To
 * carries this value; `hasKnownConversationLink` (ingestFilter) looks up
 * exactly that against stored EmailMessage.rfc822MessageId. Until now
 * that lookup could never hit for an HQ-sent conversation, which is the
 * limitation written into sendAgreementEmail's REPLY_CAPTURE_INBOX note
 * ("replies to Resend-sent mail carry an In-Reply-To HQ never stored, so
 * an ingest filter has no way to prove they belong to an HQ
 * conversation") and the reason Wes's 2026-08-28 ruling routed a copy
 * through hello@ instead of watching his own inbox. Store the id we sent
 * and that proof exists.
 *
 * Best-effort by design: if Resend overrides the Message-ID header we
 * set, the client-side threading (In-Reply-To / References) is unchanged
 * and still correct — only the linkability of the client's eventual
 * reply degrades to what it was before. It fails toward today, never
 * toward a broken send.
 *
 * ── Header injection ──────────────────────────────────────────────────
 * A parent Message-ID comes off INBOUND mail: it is a stranger's text
 * going into an SMTP header. `normalizeMessageId` is the only way values
 * enter these headers, and it rejects anything carrying CR, LF, spaces,
 * nested angle brackets or absurd length rather than trying to repair
 * it. A dropped header costs threading on one email; a smuggled newline
 * costs header injection on every one.
 */

import { randomUUID } from 'crypto'

/**
 * A conservative Message-ID body (the part inside the angle brackets):
 * printable ASCII, no whitespace, no angle brackets, no comma or
 * semicolon. Deliberately narrower than the RFC's msg-id grammar — we
 * only need to recognise ids real mail servers emit, and every
 * character we refuse is one that cannot reach a header.
 */
const MESSAGE_ID_BODY = /^[\x21-\x3B\x3D\x3F-\x7E]+$/

/** Longer than any legitimate Message-ID; past this it is an attack or a bug. */
const MAX_MESSAGE_ID_LENGTH = 512

/**
 * How many ids to keep in References. RFC 5322 tells implementations to
 * trim rather than emit an unbounded header, and the convention is to
 * keep the ROOT plus the most recent ancestors — the root is what a
 * client uses to place a message in the right conversation, so it is the
 * one id that must never be dropped.
 */
export const MAX_REFERENCES = 20

/**
 * Pull the `<...>` ids out of an In-Reply-To / References header.
 * Canonical for the app — ingestFilter's LINKED-mode proof uses this
 * too, so "what counts as an id in a chain" has exactly one answer.
 */
export function parseMessageIds(header: string | null | undefined): string[] {
  if (!header) return []
  return header.match(/<[^<>\s]+>/g) ?? []
}

/**
 * Canonicalise one Message-ID to `<body>` form, or null if it cannot be
 * trusted in a header. Accepts ids with or without angle brackets —
 * different mail servers store them both ways and our own DB has both.
 */
export function normalizeMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > MAX_MESSAGE_ID_LENGTH) return null
  // Strip ONE layer of angle brackets if present; anything else keeps
  // its brackets and fails the body test below rather than being peeled
  // repeatedly until it looks acceptable.
  const body = trimmed.startsWith('<') && trimmed.endsWith('>')
    ? trimmed.slice(1, -1)
    : trimmed
  if (!MESSAGE_ID_BODY.test(body)) return null
  // A Message-ID is addr-spec shaped: exactly one @, both sides present.
  const at = body.indexOf('@')
  if (at <= 0 || at !== body.lastIndexOf('@') || at === body.length - 1) return null
  return `<${body}>`
}

/** Normalise a whole chain, dropping anything untrustworthy, deduped in order. */
export function normalizeMessageIds(raw: string | null | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of parseMessageIds(raw)) {
    const norm = normalizeMessageId(id)
    if (!norm || seen.has(norm)) continue
    seen.add(norm)
    out.push(norm)
  }
  return out
}

/**
 * Mint a Message-ID for a message WE are sending.
 *
 * The domain must be the sending domain (sirreel.com) — a Message-ID on
 * someone else's domain is a spam signal at some receivers, and the
 * whole point is that this id is ours to recognise later. `kind` is a
 * readable prefix so the id is identifiable in a header dump.
 */
export function mintMessageId(kind: string, domain = 'sirreel.com'): string {
  const safeKind = kind.replace(/[^a-z0-9-]/gi, '').slice(0, 32) || 'hq'
  return `<${safeKind}.${randomUUID()}@${domain}>`
}

/**
 * The References header for a reply: the parent's own References chain
 * followed by the parent's Message-ID (RFC 5322 §3.6.4).
 *
 * Returns null when there is nothing trustworthy to reference — callers
 * must then omit the header rather than send an empty one.
 */
export function buildReferences(
  parentReferences: string | null | undefined,
  parentMessageId: string | null | undefined,
): string | null {
  const chain = normalizeMessageIds(parentReferences)
  const parent = normalizeMessageId(parentMessageId)
  if (parent && !chain.includes(parent)) chain.push(parent)
  if (chain.length === 0) return null
  if (chain.length <= MAX_REFERENCES) return chain.join(' ')
  // Trim the MIDDLE: keep the root (thread identity) and the most recent
  // ancestors (what the client actually matches against).
  return [chain[0], ...chain.slice(chain.length - (MAX_REFERENCES - 1))].join(' ')
}

/**
 * `Re: ` a subject without stacking prefixes.
 *
 * Only an existing leading Re: counts — a Fwd: still gets one, because
 * replying to a forward IS a reply. Matches the loose forms mail clients
 * actually emit (`RE:`, `Re :`, `Re[2]:`).
 */
export function replySubject(subject: string | null | undefined): string {
  const s = (subject ?? '').trim()
  if (!s) return 'Re:'
  return /^re\s*(\[\d+\])?\s*:/i.test(s) ? s : `Re: ${s}`
}

/** What a send needs in order to sit inside an existing conversation. */
export interface OutboundThreading {
  /** Message-ID we are assigning to THIS message. Always set. */
  messageId: string
  /** Parent's Message-ID, when replying to something. */
  inReplyTo?: string | null
  /** Full ancestor chain including the parent. */
  references?: string | null
}

/**
 * Build the threading for a reply to a stored inbound message. Pass the
 * parent's `rfc822MessageId` and (if we have it) the parent's own
 * References chain.
 */
export function threadingForReplyTo(args: {
  kind: string
  parentMessageId: string | null | undefined
  parentReferences?: string | null
}): OutboundThreading {
  return {
    messageId: mintMessageId(args.kind),
    inReplyTo: normalizeMessageId(args.parentMessageId),
    references: buildReferences(args.parentReferences, args.parentMessageId),
  }
}

/**
 * The literal headers to hand the mail API. Only well-formed values
 * survive normalization, so this output is always header-safe.
 */
export function buildThreadingHeaders(
  threading: OutboundThreading | null | undefined,
): Record<string, string> | undefined {
  if (!threading) return undefined
  const headers: Record<string, string> = {}
  const messageId = normalizeMessageId(threading.messageId)
  if (messageId) headers['Message-ID'] = messageId
  const inReplyTo = normalizeMessageId(threading.inReplyTo)
  if (inReplyTo) headers['In-Reply-To'] = inReplyTo
  // Rebuilt from the normalized chain rather than passed through, so a
  // caller cannot hand us a References string we never validated.
  const references = normalizeMessageIds(threading.references)
  if (references.length) headers['References'] = references.join(' ')
  return Object.keys(headers).length > 0 ? headers : undefined
}
