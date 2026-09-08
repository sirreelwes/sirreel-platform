/**
 * Auto-reply detection — "did a HUMAN write this?"
 *
 * An out-of-office responder is not a response. Before this existed,
 * anything outbound counted as one, and the consequences were real:
 *
 *   2026-09-08 — a new-account request from Juan Gonzalez <jp@ntrlhi.com>
 *   landed in oliver@ at 02:20 UTC. Oliver's vacation responder answered
 *   at 02:20 ("Out of office Re: New account - Cortex Creative - TS X O"),
 *   which stamped EmailThread.lastOutboundAt. Dylan Palley's real reply
 *   arrived at 02:21. The thread was therefore muted out of New inbound —
 *   Oliver: "did not see this inquiry on my HQ dashboard".
 *
 *   2026-09-04 — the same responder produced the "Gmail bounces" weekend
 *   (see src/lib/email/bounceEvent.ts).
 *
 * ── Headers are the authority ──────────────────────────────────────
 * Verified 2026-09-08 by pulling the raw Gmail headers of both the
 * responders above and of Oliver's genuine reply on the same thread.
 * Google's vacation responder sets, on the copy that lands in SENT:
 *
 *   Precedence: bulk
 *   X-Autoreply: yes
 *   Auto-Submitted: auto-replied     ← RFC 3834
 *
 * The human reply carried none of the three. So detection is a header
 * read, not a guess.
 *
 * `Precedence: bulk` on its own is NOT a signal — newsletters and list
 * mail set it too. Only `Precedence: auto_reply` counts.
 *
 * ── The subject fallback, and why it is shaped this way ────────────
 * Historical rows predate header capture, and not every responder in the
 * world sets the headers. The naive regex — /^(Out of office|Automatic
 * reply)/i — is worse than it looks: it MISSES Jose's responder, whose
 * subject is "Sirreel | Out of Office | Closed Re: <original>", and that
 * is the dominant form in our own data.
 *
 * What actually discriminates is WHERE the marker sits. A responder
 * prefixes its banner to the original subject, so the marker lands
 * BEFORE the "Re:", with the original subject still trailing it. A human
 * replying about a colleague's absence writes "Re: out of office
 * coverage" — marker AFTER; a human ANNOUNCING one writes "Out of
 * Office" and nothing more. So the fallback inspects the text preceding
 * the first "Re:" and requires a real subject to remain after the banner.
 *
 * It is still a heuristic and it is second in line: a human subject like
 * "Out of office coverage next week" would match. It only ever runs on
 * messages whose headers we do not have.
 */

type HeaderLike = { name?: string | null; value?: string | null }

/**
 * Header names the metadata-only ingest paths (gmail/fetch, gmail/sync)
 * must request. pubsub uses format=full and gets everything for free.
 */
export const AUTO_REPLY_HEADER_NAMES = [
  'Auto-Submitted',
  'X-Autoreply',
  'X-Autorespond',
  'Precedence',
] as const

export interface AutoReplyVerdict {
  isAutoReply: boolean
  /** Which signal fired — for logs and for the backfill journal. */
  signal: string | null
}

const NOT_AUTO = { isAutoReply: false, signal: null } as const

/**
 * Responder banners, matched against the part of the subject that comes
 * before the first "Re:" (see the note above).
 */
const SUBJECT_MARKER =
  /(out of (the )?office|automatic reply|automatic response|auto[-\s]?reply|autoresponder|away from (the|my) (desk|office)|vacation (reply|response))/i

export function autoReplySubjectMarker(subject: string | null | undefined): boolean {
  if (!subject) return false
  // Everything up to the first "Re:" — the banner a responder prepended.
  // No "Re:" at all: the whole subject is the banner candidate (Outlook
  // writes "Automatic reply: <original>", with no Re: anywhere).
  const banner = subject.split(/\bre\s*:/i)[0] ?? subject
  if (!banner.trim()) return false
  const m = SUBJECT_MARKER.exec(banner)
  if (!m) return false
  // A banner is a PREFIX on somebody else's subject, so a subject must
  // remain after it. Without this, a human message whose subject is just
  // "Out of Office" reads as a responder — three of Jose's did, found
  // while auditing the 2026-09-08 backfill.
  const rest = subject
    .slice(m.index + m[0].length)
    .replace(/^[\s:|,\-–—]+/, '')
    .replace(/^re\s*:\s*/i, '')
    .trim()
  return rest.length > 0
}

export function autoReplyHeaderSignal(headers: HeaderLike[] | null | undefined): string | null {
  if (!headers || headers.length === 0) return null
  const get = (name: string): string | null => {
    const target = name.toLowerCase()
    const h = headers.find((x) => x.name?.toLowerCase() === target)
    const v = h?.value?.trim().toLowerCase()
    return v || null
  }

  // RFC 3834: any value other than "no" means the message was generated
  // automatically. "auto-replied" / "auto-generated" / "auto-notified".
  const autoSubmitted = get('Auto-Submitted')
  if (autoSubmitted && autoSubmitted !== 'no') return `auto-submitted:${autoSubmitted}`

  // Pre-RFC vendor headers. Present-and-not-"no" is the contract.
  for (const name of ['X-Autoreply', 'X-Autorespond'] as const) {
    const v = get(name)
    if (v && v !== 'no' && v !== 'false') return `${name.toLowerCase()}:${v}`
  }

  // Deliberately narrow — "bulk" is newsletters, not autoresponders.
  const precedence = get('Precedence')
  if (precedence === 'auto_reply' || precedence === 'auto-reply') return `precedence:${precedence}`

  return null
}

/**
 * Is this message machine-generated? Headers decide when they say yes;
 * the subject banner is the fallback for rows/ingests without them.
 */
export function detectAutoReply(input: {
  headers?: HeaderLike[] | null
  subject?: string | null
}): AutoReplyVerdict {
  const header = autoReplyHeaderSignal(input.headers)
  if (header) return { isAutoReply: true, signal: header }
  if (autoReplySubjectMarker(input.subject)) return { isAutoReply: true, signal: 'subject' }
  return NOT_AUTO
}
