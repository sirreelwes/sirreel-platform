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
