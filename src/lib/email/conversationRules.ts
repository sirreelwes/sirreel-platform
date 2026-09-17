/**
 * The job Conversation — pure rules (no prisma, no I/O).
 *
 * Phase 2 of one-thread-per-job (docs/specs/job-thread-one-conversation.md).
 * Phase 1 put the anchors on every send and taught the ingest to file
 * replies; this is the SURFACE: one merged stream on the job page across
 * every email filed to the job, internal notes interleaved, a lane on
 * every row, and a claim ("Jose is answering" / "Handed to Billing").
 *
 * Wes 2026-09-17, on billing sharing the thread: recipients are per
 * MESSAGE, never per thread, so Gmail is unaffected; on the job page
 * everyone sees the whole story, kept tidy by LANES and a hand-off.
 *
 * Tested by `npm run test:job-conversation`.
 */

export type ConversationKind = 'client' | 'staff' | 'system'
export type ConversationLane = 'SALES' | 'BILLING'

/** The automated sender every system send goes out as (sendAgreementEmail.SEND_FROM). */
export const SYSTEM_SENDER = 'notifications@sirreel.com'
const INTERNAL_DOMAIN = 'sirreel.com'
/** Inboxes whose mail is billing's, whatever the words. */
const BILLING_INBOXES = new Set(['billing@sirreel.com', 'payments@sirreel.com', 'ana@sirreel.com'])

/** The marker recordOutboundOnThread writes into triageNotes so a system row knows what it was. */
export const LABEL_PREFIX = 'label:'

export function bareAddress(s: string | null | undefined): string {
  if (!s) return ''
  const m = s.match(/<([^>]+)>/)
  return (m ? m[1] : s).trim().toLowerCase()
}

export function isInternal(address: string | null | undefined): boolean {
  return bareAddress(address).endsWith(`@${INTERNAL_DOMAIN}`)
}

/** Who wrote it: the client, one of us, or the system. */
export function kindFor(args: { direction: string | null | undefined; fromAddress: string }): ConversationKind {
  const from = bareAddress(args.fromAddress)
  if (from === SYSTEM_SENDER) return 'system'
  if (isInternal(from)) return 'staff'
  // An inbound from an outside address is the client; an "outbound" from
  // an outside address cannot happen, but read it as client rather than
  // pretend it is ours.
  return 'client'
}

/** Send labels (EmailPayload.label) that belong to billing's lane. */
const BILLING_LABEL_RE = /^(send-invoice|send-pre-invoice|final-invoice|collections|invoice|payment-info|payment-share)/i

/**
 * Which lane a row sits in. Lanes keep the stream tidy and route the
 * "someone should answer this" signal: a reply into billing@ is Ana's,
 * not Jose's. Derived on read — no column.
 */
export function laneFor(args: {
  kind: ConversationKind
  fromAddress: string
  /** The inbox the message landed in (routingHeaders.deliveredTo / toAddresses[0]) — inbound only. */
  deliveredTo?: string | null
  toAddresses?: string[] | null
  ccAddresses?: string | null
  /** The author's HQ role when the row is one of ours. */
  authorRole?: string | null
  /** The send label a system row was recorded with. */
  label?: string | null
}): ConversationLane {
  if (args.kind === 'system') return args.label && BILLING_LABEL_RE.test(args.label) ? 'BILLING' : 'SALES'
  if (args.kind === 'staff') {
    if (args.authorRole === 'BILLING') return 'BILLING'
    return BILLING_INBOXES.has(bareAddress(args.fromAddress)) ? 'BILLING' : 'SALES'
  }
  const landed = [
    bareAddress(args.deliveredTo),
    ...(args.toAddresses ?? []).map(bareAddress),
    ...(args.ccAddresses ?? '').split(',').map(bareAddress),
  ].filter(Boolean)
  return landed.some((a) => BILLING_INBOXES.has(a)) ? 'BILLING' : 'SALES'
}

/** Pull the send label back out of a recorded outbound row's triageNotes. */
export function labelFromTriageNotes(notes: string | null | undefined): string | null {
  if (!notes) return null
  const line = notes.split('\n').find((l) => l.startsWith(LABEL_PREFIX))
  return line ? line.slice(LABEL_PREFIX.length).trim() || null : null
}

/**
 * What a system row says about itself. The send labels are the ones the
 * routes already stamp on EmailDelivery; a new send site with an unknown
 * label reads as "Sent by HQ" rather than nothing.
 */
export function systemLabel(label: string | null | undefined): string {
  const l = (label || '').toLowerCase()
  if (l.startsWith('send-quote')) return 'Quote sent'
  if (l.startsWith('job-welcome')) return 'Welcome email'
  if (l.startsWith('paperwork-summary')) return 'Paperwork summary'
  if (l.startsWith('follow-up')) return 'Follow-up'
  if (l.startsWith('portal/invite') || l.startsWith('portal-invite')) return 'Portal invite'
  if (l.startsWith('send-pre-invoice')) return 'Pre-invoice sent'
  if (l.startsWith('send-invoice')) return 'Invoice sent'
  if (l.startsWith('final-invoice')) return 'Final invoice sent'
  if (l.startsWith('cadence/')) return 'Follow-up (automatic)'
  // 2026-09-17 (Wes: "does that automatically fall within the same email
  // thread? If it doesn't let's make sure it does") — every client-facing
  // send on a known job rides the thread now, so each needs a name here.
  if (l.startsWith('resend-quote-on-change')) return 'Updated quote sent'
  if (l.startsWith('card-auth-request')) return 'Card authorization sent'
  if (l.startsWith('card-auth-handoff')) return 'Card authorization handed to a colleague'
  if (l.startsWith('self-serve')) return 'What happens next'
  if (l.startsWith('thank-you')) return 'Thank-you sent'
  if (l.startsWith('orders/agreement/resend-link') || l.startsWith('portal/resend-link')) return 'Portal link re-sent'
  if (l.startsWith('orders/contacts/invite') || l.startsWith('portal/authorize')) return 'Portal invite'
  if (l.startsWith('orders/contract-review/accept')) return 'Agreement ready to sign'
  if (l.startsWith('contract-review/counter-notice')) return 'Counter-proposal sent'
  if (l.startsWith('agreement/reissue')) return 'Agreement re-issued to sign'
  if (l.startsWith('portal/agreement/sign')) return 'Rental agreement signed — copy sent'
  if (l.startsWith('portal/v2/stage-sign')) return 'Stage contract signed — copy sent'
  if (l.startsWith('stage-ready-to-sign')) return 'Stage contract ready to sign'
  if (l.startsWith('payment-info')) return 'Payment details sent'
  if (l.startsWith('payment-share')) return 'Payment details shared'
  if (l.startsWith('job/after-hours-share')) return 'After-hours link shared'
  if (l.startsWith('job/after-hours')) return 'After-hours access sent'
  if (l.startsWith('job/vehicle-pickup')) return 'Vehicle pickup instructions sent'
  if (l.startsWith('driver/request')) return 'Driver details requested'
  if (l.startsWith('coi-request-fix')) return 'COI — more needed'
  if (l.startsWith('coi-approved')) return 'COI approved'
  if (l.startsWith('coi-requirements')) return 'COI requirements sent to the broker'
  if (l.startsWith('sub-rental-estimate')) return 'Estimate sent'
  return 'Sent by HQ'
}

/** "Quote sent" needs the number beside it when the label carries one (`send-quote:S260912-003`). */
export function labelDetail(label: string | null | undefined): string | null {
  if (!label) return null
  const i = label.indexOf(':')
  if (i < 0) return null
  const rest = label.slice(i + 1).trim()
  // follow-up:STAGE_2:S260912-003 → the last segment is the order
  const parts = rest.split(':').filter(Boolean)
  return parts.length ? parts[parts.length - 1] : null
}

// ── Claim ("Jose is answering" / "Handed to Billing") ────────────────

export interface ClaimState {
  claimedByUserId: string | null
  claimedLane: ConversationLane | null
  claimedAt: Date | null
}

export type ClaimAction =
  | { action: 'claim'; userId: string; lane?: ConversationLane }
  | { action: 'release' }
  | { action: 'hand'; lane: ConversationLane }

/**
 * The next claim state. "claim" makes the actor the answerer (any prior
 * claim is simply replaced — a conversation has one answerer, and the
 * newest hand up wins); "hand" points the lane at a desk with nobody
 * yet holding it (Billing sees the ping and someone there claims);
 * "release" clears everything.
 */
export function applyClaim(current: ClaimState, action: ClaimAction, now: Date): ClaimState {
  switch (action.action) {
    case 'claim':
      return { claimedByUserId: action.userId, claimedLane: action.lane ?? current.claimedLane ?? 'SALES', claimedAt: now }
    case 'hand':
      return { claimedByUserId: null, claimedLane: action.lane, claimedAt: now }
    case 'release':
      return { claimedByUserId: null, claimedLane: null, claimedAt: null }
  }
}

/** The chip text. Null = nothing to show. */
export function claimLabel(state: ClaimState, nameOf: (userId: string) => string | null): string | null {
  if (state.claimedByUserId) {
    const name = nameOf(state.claimedByUserId) || 'Someone'
    return `${name} is answering`
  }
  if (state.claimedLane) return `Handed to ${state.claimedLane === 'BILLING' ? 'Billing' : 'Sales'}`
  return null
}

// ── Internal notes ───────────────────────────────────────────────────

export const NOTE_MAX = 4000

/** Trim, bound, refuse empty. Null = not a note. */
export function cleanNote(body: unknown): string | null {
  if (typeof body !== 'string') return null
  const t = body.replace(/\r\n/g, '\n').trim()
  if (!t) return null
  return t.slice(0, NOTE_MAX)
}

/**
 * Who a note @mentions, matched against the staff list by first name or
 * full name (case-insensitive). "@Ana" and "@Jose Pacheco" both match;
 * a stray "@" or an unknown name matches nobody. Returns user ids, deduped,
 * in order of first mention.
 */
export function mentionsIn(body: string, staff: { id: string; name: string }[]): string[] {
  const out: string[] = []
  const tokens = body.match(/@([A-Za-z][A-Za-z'.-]*(?:\s+[A-Z][A-Za-z'.-]*)?)/g) ?? []
  for (const tok of tokens) {
    const wanted = tok.slice(1).trim().toLowerCase()
    for (const s of staff) {
      const full = s.name.trim().toLowerCase()
      const first = full.split(/\s+/)[0]
      if (wanted === full || wanted === first || (wanted.includes(' ') && full.startsWith(wanted))) {
        if (!out.includes(s.id)) out.push(s.id)
        break
      }
      // "@Jose Pacheco" tokenised greedily may swallow a following capitalised
      // word ("@Ana Please") — fall back to the first word alone.
      const firstWord = wanted.split(/\s+/)[0]
      if (firstWord === first && !out.includes(s.id)) {
        out.push(s.id)
        break
      }
    }
  }
  return out
}

// ── Before a reply goes to the client ────────────────────────────────

/**
 * Wes 2026-09-17: "Things that are sent to the client need to be
 * confirmed. I'm a little bit afraid that someone's going to write an
 * internal note and accidentally send it to the client." The composer's
 * two tabs sit an inch apart and ⌘↵ worked in both, so a note typed on the
 * wrong tab was one keystroke from the client's inbox.
 *
 * Two things now stand between Send and the wire: a review step in the
 * panel (To, Cc, From, the whole message, then a second Send), and the
 * server refusing a send that does not say it was reviewed
 * (`confirmed: true` on POST /api/jobs/[id]/email). This rule feeds the
 * review step: the tells that a message was meant for the team, so the
 * review can say so out loud and offer "Save as a note instead".
 *
 * Tells, all read off the text: an @mention of someone on staff (the
 * client has no idea who @Hugo is), a team-facing opener ("Hey team",
 * "Hi all", "Team,"), or a staff FIRST NAME used as an address ("Oliver,
 * can you…"). None of them block — a rep can legitimately write "Hi all"
 * to a production — they make the review louder.
 */
export function internalNoteTells(body: string, staff: { id: string; name: string }[]): string[] {
  const tells: string[] = []
  const text = body.trim()
  if (!text) return tells

  const mentioned = mentionsIn(text, staff)
  if (mentioned.length > 0) {
    const names = mentioned
      .map((id) => staff.find((s) => s.id === id)?.name.split(/\s+/)[0])
      .filter((n): n is string => !!n)
    tells.push(`mentions ${names.map((n) => `@${n}`).join(', ')} — the client does not know who that is`)
  }

  const opener = text.split('\n')[0].trim().toLowerCase().replace(/[!.,:\s]+$/, '')
  if (/^(hey|hi|hello|yo)?\s*(team|all|everyone|guys|folks)$/.test(opener) || /^(hey|hi|hello)\s+(team|all|everyone|guys|folks)\b/.test(opener)) {
    tells.push(`opens "${text.split('\n')[0].trim()}" — that reads as a note to the team`)
  }

  // "Oliver, can you…" / "Hugo — " at the start of a line: a colleague
  // addressed by first name. Only a FULL-word match at a line start, so
  // "Ana" inside "Anaheim" and a client who shares a name mid-sentence
  // do not trip it.
  const firsts = new Set(staff.map((s) => s.name.trim().split(/\s+/)[0].toLowerCase()).filter((n) => n.length > 2))
  const addressed = new Set<string>()
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^([A-Za-z][A-Za-z'.-]*)\s*[,—:-]/)
    if (m && firsts.has(m[1].toLowerCase())) addressed.add(m[1])
  }
  if (addressed.size > 0) {
    tells.push(`addresses ${[...addressed].join(', ')} by name — someone on the team`)
  }
  return tells
}

/** Merge emails and notes into one stream, oldest first. Stable on ties (email before note). */
export function mergeTimeline<E extends { at: Date }, N extends { at: Date }>(
  emails: E[],
  notes: N[],
): Array<(E & { kind: 'email' }) | (N & { kind: 'note' })> {
  const rows: Array<(E & { kind: 'email' }) | (N & { kind: 'note' })> = [
    ...emails.map((e) => ({ ...e, kind: 'email' as const })),
    ...notes.map((n) => ({ ...n, kind: 'note' as const })),
  ]
  return rows.sort((a, b) => {
    const d = a.at.getTime() - b.at.getTime()
    if (d !== 0) return d
    return a.kind === b.kind ? 0 : a.kind === 'email' ? -1 : 1
  })
}

/**
 * Is the client waiting on us? True when the newest client message is
 * newer than the newest thing we sent. Notes do not count — a note is
 * not an answer.
 */
export function awaitingReply(rows: Array<{ kind: ConversationKind; at: Date }>): boolean {
  let lastClient: number | null = null
  let lastOurs: number | null = null
  for (const r of rows) {
    const t = r.at.getTime()
    if (r.kind === 'client') lastClient = lastClient == null ? t : Math.max(lastClient, t)
    else lastOurs = lastOurs == null ? t : Math.max(lastOurs, t)
  }
  if (lastClient == null) return false
  return lastOurs == null || lastClient > lastOurs
}

// ── Urgent notes ─────────────────────────────────────────────────────
//
// Wes 2026-09-17: "Is there a way to mark something urgent or send text
// messages? Something that elevates it from an internal chat, which we
// don't necessarily need text messages for, to 'this needs to be seen
// right now' by whomever is tagged." A plain note pings nobody. A note
// sent with the Urgent toggle reaches every tagged person at once: a text
// to the mobile on file, an email when there is no mobile, and an honest
// "unreachable" when there is neither. The author is never on the list.

export type AlertChannel = 'SMS' | 'EMAIL' | 'NONE'

export interface UrgentTarget {
  userId: string
  name: string
  channel: AlertChannel
  /** The number or address the alert goes to; null for NONE. */
  to: string | null
}

/**
 * Who an urgent note reaches and how. Text beats email — a text is what
 * "right now" means on a phone in a truck. Unknown ids (a user deactivated
 * since the mention was typed) are dropped rather than guessed at.
 */
export function urgentPlan(args: {
  mentions: string[]
  authorUserId: string
  staff: Array<{ id: string; name: string; email?: string | null; phone?: string | null }>
}): UrgentTarget[] {
  const byId = new Map(args.staff.map((s) => [s.id, s]))
  const out: UrgentTarget[] = []
  const seen = new Set<string>()
  for (const id of args.mentions) {
    if (id === args.authorUserId || seen.has(id)) continue
    const s = byId.get(id)
    if (!s) continue
    seen.add(id)
    const phone = (s.phone ?? '').trim()
    const email = (s.email ?? '').trim().toLowerCase()
    if (phone) out.push({ userId: id, name: s.name, channel: 'SMS', to: phone })
    else if (email) out.push({ userId: id, name: s.name, channel: 'EMAIL', to: email })
    else out.push({ userId: id, name: s.name, channel: 'NONE', to: null })
  }
  return out
}

/** How much of the note rides in the text. One SMS segment is 160; the
 *  frame + link + the STOP line sendTracked appends take the rest. */
export const URGENT_SMS_EXCERPT = 140

/**
 * The text an urgent note sends. Who, which job, the first line of the
 * note, the link straight to that job's Conversation tab. `sendTracked`
 * adds the STOP line itself.
 */
export function urgentSmsText(args: { byName: string; jobName: string; jobCode: string; body: string; url: string }): string {
  const firstName = args.byName.trim().split(/\s+/)[0] || 'HQ'
  const line = args.body.replace(/\s+/g, ' ').trim()
  const excerpt = line.length > URGENT_SMS_EXCERPT ? `${line.slice(0, URGENT_SMS_EXCERPT - 1).trimEnd()}…` : line
  return `URGENT from ${firstName} on ${args.jobName} (${args.jobCode}): ${excerpt} ${args.url}`
}

/**
 * One line for the note card and the sender's toast: "texted Ana · emailed
 * Julian · Chris unreachable (no mobile or email)". A failed send says so —
 * the sender must not believe a text went out when Twilio refused it.
 */
export function alertSummary(alerts: Array<{ name: string; channel: AlertChannel; status: string }>): string {
  if (alerts.length === 0) return ''
  const first = (n: string) => n.trim().split(/\s+/)[0] || n
  return alerts
    .map((a) => {
      const ok = a.status === 'SENT'
      if (a.channel === 'SMS') return ok ? `texted ${first(a.name)}` : `text to ${first(a.name)} failed`
      if (a.channel === 'EMAIL') return ok ? `emailed ${first(a.name)}` : `email to ${first(a.name)} failed`
      return `${first(a.name)} unreachable (no mobile or email)`
    })
    .join(' · ')
}

// ── The Chat page: every job conversation you are IN ──────────────────
//
// Wes 2026-09-17: "let's create a chat tab on the left menu … all chats,
// no matter which job, will show up here" — then, at once: "the chats
// shouldn't be for everyone. It should be for everyone who is included in
// that chat. In other words if it was directly @billing, it wouldn't show
// up in Hugo's and vice versa."
//
// So the page is NOT a firehose of every conversation. A job reaches your
// list only for a REASON, and the reason is shown on the row — if you
// cannot see why a job is in your chat list, the rule is wrong.

export type ChatReason =
  /** @you in a note on that job. */
  | 'mentioned'
  /** You hold the claim — "<you> is answering". */
  | 'holding'
  /** You wrote a note there, or sent/received mail on the thread. */
  | 'wrote'
  /** You are the agent on the job. */
  | 'rep'
  /** It was handed to your desk (Billing today), or landed in its inbox. */
  | 'desk'

/** Strongest first — the one the row shows, and the tie-break for equal tiers. */
export const CHAT_REASON_ORDER: readonly ChatReason[] = ['mentioned', 'holding', 'wrote', 'rep', 'desk']

export function strongestReason(reasons: readonly ChatReason[]): ChatReason | null {
  for (const r of CHAT_REASON_ORDER) if (reasons.includes(r)) return r
  return null
}

/** Why this job is in your list, in your words. */
export function inclusionLabel(reasons: readonly ChatReason[]): string {
  switch (strongestReason(reasons)) {
    case 'mentioned': return 'You were tagged'
    case 'holding': return 'You are answering'
    case 'wrote': return 'You wrote here'
    case 'rep': return 'Your job'
    case 'desk': return 'Billing desk'
    default: return ''
  }
}

/** Ana's desk: the BILLING role, or one of the billing inboxes. */
export function isBillingDesk(args: { role?: string | null; email?: string | null }): boolean {
  if ((args.role || '').toUpperCase() === 'BILLING') return true
  return BILLING_INBOXES.has(bareAddress(args.email))
}

export interface ChatTierInput {
  /** An urgent note tagged you and you have not written since. */
  urgentForMe: boolean
  /** A note tagged you and you have not written since. */
  taggedMe: boolean
  /** The client's newest message is newer than anything we sent. */
  awaitingReply: boolean
}

/**
 * How loudly a row asks for you. Lower sorts first: someone put your name
 * on it and said it was urgent, then your name, then a waiting client,
 * then everything else. Deliberately NOT "newest first" overall — a chat
 * list sorted purely by time buries the one row that named you.
 */
export function chatTier(r: ChatTierInput): number {
  if (r.urgentForMe) return 0
  if (r.taggedMe) return 1
  if (r.awaitingReply) return 2
  return 3
}

/** Tier first, then newest activity. Pure; the page renders this order. */
export function sortChatRows<T extends ChatTierInput & { lastAt: Date }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const t = chatTier(a) - chatTier(b)
    if (t !== 0) return t
    return b.lastAt.getTime() - a.lastAt.getTime()
  })
}

/** One line of the newest message, for the row. Notes and mail both. */
export const CHAT_PREVIEW_MAX = 160

export function chatPreview(body: string | null | undefined): string {
  const line = (body || '').replace(/\s+/g, ' ').trim()
  if (line.length <= CHAT_PREVIEW_MAX) return line
  return `${line.slice(0, CHAT_PREVIEW_MAX - 1).trimEnd()}…`
}
