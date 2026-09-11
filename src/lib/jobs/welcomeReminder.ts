/**
 * The job WELCOME email — "send them the link" — and the reminder to send it.
 *
 * Wes 2026-09-11: "When a client sends a request and our team replies with
 * a quote, there is a button for the portal. I would like that button to
 * generate on the job tile or page or both to remind us to send the welcome
 * email."
 *
 * Two facts decide the reminder, and both are read here so the /jobs tile,
 * the job page button and the send route cannot disagree:
 *
 *   quotedAt  — the newest `quoteSentAt` across the job's LIVE orders
 *               (cancelled / archived dropped by liveOrdersForRollup).
 *   sentAt    — the newest AuditLog row `job.welcome_sent` on the job.
 *               No new column: the send is a fact about a moment, exactly
 *               as the paperwork summary's is.
 *
 * The reminder is DUE while a quote is out and no welcome has gone. It
 * fades after WELCOME_REMINDER_WINDOW_DAYS: a job quoted five weeks ago
 * with no welcome is either lost or long past introductions, and a
 * reminder on 150 old quotes is wallpaper by Friday (the same rule the
 * /jobs list already lives by — nothing older than 30 days on the main
 * page). It also only counts quotes on orders that have NOT gone out
 * yet (QUOTE_SENT → LOADED_READY): once the gear is on the job the
 * welcome moment has passed, and "Welcome" on a truck that is already
 * on set is noise. Measured on ship day (2026-09-11): 52 jobs read DUE
 * — every client quoted in the last 30 days and never welcomed; that
 * is the backlog, not wallpaper, and it clears one send at a time. The
 * job page's button stays available either way; only the nag fades.
 * WRAPPED / LOST jobs never nag.
 */

import { liveOrdersForRollup } from './liveOrders'

/** AuditLog.action written by POST /api/jobs/[id]/welcome/send. */
export const WELCOME_SENT_ACTION = 'job.welcome_sent'

/** How long after the quote the tile keeps reminding. */
export const WELCOME_REMINDER_WINDOW_DAYS = 30

export type WelcomeState =
  /** A quote is out, nothing welcomed the client yet — say so. */
  | 'due'
  /** The welcome went out (at `sentAt`). */
  | 'sent'
  /** Nothing to say: not quoted yet, quoted too long ago, or off the ladder. */
  | 'none'

export interface WelcomeSignal {
  state: WelcomeState
  /** Newest quote on any live order — informational; see `state`. */
  quotedAt: Date | null
  sentAt: Date | null
}

/** Order statuses before the gear leaves the yard — the only ones whose
 *  quote can make the reminder DUE. */
const PRE_PICKUP: ReadonlySet<string> = new Set([
  'DRAFT',
  'QUOTE_SENT',
  'APPROVED',
  'BOOKED',
  'LOADED_READY',
])

export interface WelcomeSignalInputs {
  jobStatus: string
  orders: { status: string; archivedAt?: Date | string | null; quoteSentAt: Date | string | null }[]
  /** Newest `job.welcome_sent` audit row, or null. */
  sentAt: Date | string | null
  now?: Date
}

function asDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export function welcomeSignal(i: WelcomeSignalInputs): WelcomeSignal {
  const now = i.now ?? new Date()
  const sentAt = asDate(i.sentAt)
  const live = liveOrdersForRollup(i.orders)
  const newest = (list: typeof live): Date | null =>
    list
      .map((o) => asDate(o.quoteSentAt))
      .filter((d): d is Date => d !== null)
      .reduce<Date | null>((max, d) => (max === null || d > max ? d : max), null)
  const quotedAt = newest(live)
  const pendingQuotedAt = newest(live.filter((o) => PRE_PICKUP.has(o.status)))

  if (sentAt) return { state: 'sent', quotedAt, sentAt }
  if (i.jobStatus === 'WRAPPED' || i.jobStatus === 'LOST') return { state: 'none', quotedAt, sentAt }
  if (!pendingQuotedAt) return { state: 'none', quotedAt, sentAt }
  const cutoff = now.getTime() - WELCOME_REMINDER_WINDOW_DAYS * 86_400_000
  if (pendingQuotedAt.getTime() < cutoff) return { state: 'none', quotedAt, sentAt }
  return { state: 'due', quotedAt, sentAt }
}

/**
 * The body a rep starts from — Wes's words (2026-09-11), verbatim but for
 * the greeting line above them. Seeded into the review modal's compose
 * box, and rendered by the template when the box is left blank, so what
 * the rep sees is what the client receives. The link itself is the button
 * the template adds underneath; "follow this link" points at it.
 */
export function defaultJobWelcomeBody(firstName: string | null | undefined): string {
  const hi = firstName?.trim() ? `Hi ${firstName.trim()},` : 'Hi there,'
  return [
    hi,
    '',
    'Welcome to SirReel. We just wanted to quickly reach out and say that we are looking forward to working with you and provide you with a link to the job.',
    '',
    "Paperwork can be done here, orders can be viewed and changed all the way to the final invoice being paid. It doesn't require you to log in — just follow this link!",
  ].join('\n')
}
