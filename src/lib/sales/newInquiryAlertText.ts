/**
 * The words and the clock for AHA's "new incoming" text — the pure half of
 * src/lib/sales/notifyNewInquirySms.ts, split out so it can be tested
 * offline (the notifier itself pulls in the Prisma singleton).
 *
 * Wes 2026-09-11: "Can AHA text me when there's a new incoming and drop a
 * link in the text to open that response?"
 */
import { ASSISTANT_NAME } from '@/lib/assistant/identity'

const TZ = 'America/Los_Angeles'

/** Waking hours, Pacific. Wes 2026-09-11: "immediately between 8a-10p". */
export const WINDOW_OPEN_HOUR = 8
export const WINDOW_CLOSE_HOUR = 22

/** Keeps one long subject line from eating the whole segment. */
const MAX_TITLE_CHARS = 70

export function pacificHour(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }).formatToParts(d)
  return Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24
}

/** True when a text now would reach a person who is awake. */
export function inTextingWindow(now: Date = new Date()): boolean {
  const h = pacificHour(now)
  return h >= WINDOW_OPEN_HOUR && h < WINDOW_CLOSE_HOUR
}

export interface AlertSubject {
  id: string
  title: string
  companyName: string | null
  personName: string | null
}

/** "Jane Doe · Acme Pictures" — whichever halves we actually have. */
export function who(i: AlertSubject): string {
  const parts = [i.personName, i.companyName].filter(Boolean) as string[]
  return parts.length ? parts.join(' · ') : 'no name given'
}

export function trimTitle(t: string): string {
  const s = t.trim().replace(/\s+/g, ' ')
  return s.length > MAX_TITLE_CHARS ? `${s.slice(0, MAX_TITLE_CHARS - 1)}…` : s
}

/**
 * The text itself. One inquiry gets its own page; a batch gets the
 * Incoming panel, because five links in one SMS is not a link, it's a wall.
 *
 * `AHA` and `SirReel` both appear by design — the name so Wes knows he can
 * reply to it, the brand because the carrier campaign filed that every
 * message identifies the company.
 */
export function composeAlert(pending: AlertSubject[], appUrl: string): string {
  const base = appUrl.replace(/\/$/, '')
  if (pending.length === 1) {
    const i = pending[0]
    return `${ASSISTANT_NAME} · SirReel HQ — new incoming from ${who(i)}: ${trimTitle(i.title)} ${base}/inquiries/${i.id}`
  }
  const named = pending.slice(0, 2).map(who).join('; ')
  const rest = pending.length - 2
  return `${ASSISTANT_NAME} · SirReel HQ — ${pending.length} new incoming: ${named}${rest > 0 ? `; +${rest} more` : ''} ${base}/jobs?panel=incoming`
}

/** What the on-demand proof text says. */
export function composeTestAlert(appUrl: string): string {
  const base = appUrl.replace(/\/$/, '')
  return `${ASSISTANT_NAME} · SirReel HQ — test. This is what a new incoming looks like; the real one links the lead. ${base}/jobs?panel=incoming`
}
