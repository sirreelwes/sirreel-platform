/**
 * The words and the clock for AHA's "new incoming" text — the pure half of
 * src/lib/sales/notifyNewInquirySms.ts, split out so it can be tested
 * offline (the notifier itself pulls in the Prisma singleton).
 *
 * Wes 2026-09-11: "Can AHA text me when there's a new incoming and drop a
 * link in the text to open that response?"
 *
 * ── Where the name comes from ───────────────────────────────────────────
 * NOT from Person / Company. Measured against the live DB on 2026-09-11:
 * of the last 54 form/manual inbound rows, 32 (59%) had NEITHER linked —
 * the public forms write the who into the TITLE and resolve the records
 * later, if ever. A first draft read the relations only, so more than half
 * the texts would have said "new incoming from no name given" and a batch
 * would have been "2 new incoming: no name given; no name given".
 *
 * So the title is a first-class source, not a fallback of last resort. The
 * forms all build it as `<kind> — <identity>`:
 *
 *   Contact — Drew                                    (public/contact)
 *   Production request — Halogen Cinema · Make You    (public/supply-request)
 *   Standing Sets availability — <name>               (public/space-inquiry)
 *   Add-on request — <job name>                       (portal/add-on-request)
 *   After-hours assistant — <caller>                  (AHA's own callback)
 *   <job name>                                        (public/intake — no kind)
 *
 * splitTitle() pulls those apart so the kind can say WHERE it came from and
 * the identity can stand in as the who. A title that doesn't match the
 * shape is used whole, which is the intake case and any future form.
 */
import { ASSISTANT_NAME } from '@/lib/assistant/identity'

const TZ = 'America/Los_Angeles'

/** Waking hours, Pacific. Wes 2026-09-11: "immediately between 8a-10p". */
export const WINDOW_OPEN_HOUR = 8
export const WINDOW_CLOSE_HOUR = 22

/** Keeps one runaway field from eating the whole message. */
const MAX_PART_CHARS = 70

/** Longer than this on the left of an em-dash is prose, not a form's label. */
const MAX_KIND_CHARS = 40

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

export function tidy(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}

export function clip(s: string, max = MAX_PART_CHARS): string {
  const t = tidy(s)
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/**
 * "Production request — Halogen Cinema · Make You"
 *   → { kind: 'Production request', identity: 'Halogen Cinema · Make You' }
 *
 * Split on the FIRST em-dash only: identities carry their own separators
 * ("Halogen Cinema · Make You"), and a project name may well contain a dash
 * of its own.
 */
export function splitTitle(title: string): { kind: string | null; identity: string } {
  const t = tidy(title)
  const at = t.indexOf(' — ')
  if (at <= 0) return { kind: null, identity: t }
  const kind = t.slice(0, at)
  const identity = t.slice(at + 3).trim()
  if (!identity || kind.length > MAX_KIND_CHARS) return { kind: null, identity: t }
  return { kind, identity }
}

/** The linked records, if we have them; otherwise whoever the title names. */
export function who(i: AlertSubject): string {
  const linked = [i.personName, i.companyName].filter(Boolean) as string[]
  if (linked.length) return clip(linked.join(' · '))
  return clip(splitTitle(i.title).identity)
}

/**
 * The text itself. One inquiry gets its own page; a batch gets the Incoming
 * panel, because five links in one SMS is not a link, it's a wall.
 *
 * `AHA` and `SirReel` both appear by design — the name so Wes knows he can
 * reply to it, the brand because the carrier campaign filed that every
 * message identifies the company.
 */
export function composeAlert(pending: AlertSubject[], appUrl: string): string {
  const base = appUrl.replace(/\/$/, '')
  const lead = `${ASSISTANT_NAME} · SirReel HQ`

  if (pending.length === 1) {
    const i = pending[0]
    const { kind, identity } = splitTitle(i.title)
    const name = who(i)
    // The title's identity is added only when it says something the name
    // doesn't — otherwise an unlinked row would print itself twice.
    const linked = Boolean(i.personName || i.companyName)
    const detail = linked && identity && clip(identity) !== name ? ` — ${clip(identity)}` : ''
    return `${lead} — new incoming${kind ? `, ${kind}` : ''}: ${name}${detail} ${base}/inquiries/${i.id}`
  }

  const named = pending.slice(0, 2).map(who).join('; ')
  const rest = pending.length - 2
  return `${lead} — ${pending.length} new incoming: ${named}${rest > 0 ? `; +${rest} more` : ''} ${base}/jobs?panel=incoming`
}

/** What the on-demand proof text says. */
export function composeTestAlert(appUrl: string): string {
  const base = appUrl.replace(/\/$/, '')
  return `${ASSISTANT_NAME} · SirReel HQ — test. This is what a new incoming looks like; the real one links the lead. ${base}/jobs?panel=incoming`
}
