/**
 * AHA texts Wes when a new incoming lands, with a link that opens it.
 *
 * Wes 2026-09-11: "Can AHA text me when there's a new incoming and drop a
 * link in the text to open that response?" — immediately, between 8am and
 * 10pm Pacific; web-form, manual and portal inbound only; **Wes only**.
 *
 * This is the first thing AHA says FIRST. Every other outbound text on the
 * platform answers someone (the assistant replying to an inbound, a staff
 * member pressing Text on a job, the opt-in confirmation). Two consequences
 * worth keeping in mind when editing this file:
 *
 *   - It goes out from AHA's number, so Wes can simply REPLY to it. His
 *     phone resolves to the staff tier through identifySender(), which
 *     means the reply lands in a real AHA conversation with fleet and job
 *     lookups — see src/lib/assistant/recognizedNumbers.ts.
 *   - The carrier campaign filed that every message identifies the brand,
 *     so the body names SirReel. That is not decoration; it is what was
 *     registered.
 *
 * ── Who gets it ─────────────────────────────────────────────────────────
 * One person, by email allowlist — the pattern the payment-info and export
 * gates already use here. Not a role, not a toggle: Wes said "to be clear,
 * this text message notification ONLY goes to Wes", and an email constant
 * says that out loud where a `role = ADMIN` query would quietly fan out to
 * five people the next time someone is promoted. The number is his
 * `User.phone`.
 *
 * ── What counts as "a new incoming" ─────────────────────────────────────
 * Persistent Inquiry rows with source WEB_FORM or MANUAL — the public
 * contact/intake/supply/space forms, AHA's own after-hours callback
 * requests, client-created jobs, portal add-on requests, and anything a rep
 * types in by hand. Deliberately NOT source=GMAIL: those rows are created
 * by a rep pressing Capture on the suggestion stream, so the text would be
 * telling someone about their own click. The Gmail-detected leads stay on
 * the /jobs board where they already live.
 *
 * Payment-info submissions are excluded by title. They are WEB_FORM rows
 * like everything else, but a client asking for ACH details is not a lead
 * and does not need to reach a phone.
 *
 * ── When it sends ───────────────────────────────────────────────────────
 * Inside 8am–10pm Pacific, on the next sweep (every 5 minutes). Outside it,
 * not at all — the row is left unstamped and the first sweep after 8am
 * picks it up. Every day, weekends included: a Saturday lead is still a
 * lead, and unlike the hq@ email this one goes to a phone its owner can
 * ignore.
 *
 * ── Why one text for a batch ────────────────────────────────────────────
 * Overnight arrivals all come due at 8am. One text per row would mean a
 * five-buzz burst; over one, the alert collapses to a count plus the first
 * two names and links the Incoming panel instead of a single inquiry.
 */
import { prisma } from '@/lib/prisma'
import { sendTracked } from '@/lib/sms/threads'
import {
  composeAlert,
  composeNudge,
  composeTestAlert,
  inTextingWindow,
  WINDOW_CLOSE_HOUR,
  WINDOW_OPEN_HOUR,
  type AlertSubject,
} from '@/lib/sales/newInquiryAlertText'

export { composeAlert, composeNudge, inTextingWindow } from '@/lib/sales/newInquiryAlertText'

/** The only person this feature texts. Wes 2026-09-11, explicitly. */
export const NEW_INQUIRY_SMS_RECIPIENT = 'wes@sirreel.com'

const HQ_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com'

/**
 * Nothing older than this is ever texted about, even unstamped. The
 * backfill in scripts/add-new-inquiry-sms-columns.ts is the real guard
 * against an opening-day backlog; this is the belt to its braces, so a row
 * that somehow escapes stamping cannot resurface as a three-week-old "new"
 * lead.
 */
const MAX_AGE_HOURS = 24

/** Not a lead — a client asking for ACH details. Created WEB_FORM by /api/public/payment-info. */
const EXCLUDED_TITLES = new Set(['Payment info request'])

export interface PendingInquiry extends AlertSubject {
  source: string
  createdAt: Date
}

/** Unstamped, still open, recent, and the kind of inbound Wes asked about. */
export async function listPendingInquiries(now: Date = new Date()): Promise<PendingInquiry[]> {
  const rows = await prisma.inquiry.findMany({
    where: {
      smsNotifiedAt: null,
      status: 'NEW',
      // status=NEW is NOT "untouched". Replying stamps respondedAt and
      // leaves the status alone — it only becomes CONVERTED / DISMISSED
      // when someone explicitly works the row. Measured 2026-09-12: ALL
      // FIVE open NEW inquiries had already been replied to. Without this
      // clause the 8am release announces "new incoming" about a lead a rep
      // answered at 6am. Wes 2026-09-12 chose to skip those.
      respondedAt: null,
      source: { in: ['WEB_FORM', 'MANUAL'] },
      createdAt: { gte: new Date(now.getTime() - MAX_AGE_HOURS * 3_600_000) },
    },
    select: {
      id: true,
      title: true,
      source: true,
      createdAt: true,
      company: { select: { name: true } },
      person: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 25,
  })
  return rows
    .filter((r) => !EXCLUDED_TITLES.has(r.title.trim()))
    .map((r) => ({
      id: r.id,
      title: r.title,
      source: r.source,
      companyName: r.company?.name ?? null,
      personName: [r.person?.firstName, r.person?.lastName].filter(Boolean).join(' ').trim() || null,
      createdAt: r.createdAt,
    }))
}

/**
 * How long a lead may sit unanswered after Wes was told before the ONE
 * follow-up goes out. Wes 2026-09-12: "one nudge after 1 hr".
 *
 * Measured from smsNotifiedAt, not createdAt. An overnight lead is first
 * announced at 8am; counting from arrival would make it already "6 hours
 * unanswered" and fire the nudge in the same breath as the alert.
 */
const NUDGE_AFTER_HOURS = 1

/**
 * And a bound on the other end: something announced days ago and still
 * unanswered is a backlog problem, not a nudge. It stays on the board and
 * in the hourly hq@ escalation.
 */
const NUDGE_GIVE_UP_HOURS = 48

export interface PendingNudge extends PendingInquiry {
  notifiedAt: Date
}

/**
 * Told, still unanswered, not yet nudged. One per inquiry, ever — the
 * smsNudgedAt stamp is what stops this becoming a loop.
 */
export async function listPendingNudges(now: Date = new Date()): Promise<PendingNudge[]> {
  const rows = await prisma.inquiry.findMany({
    where: {
      smsNotifiedAt: {
        not: null,
        lte: new Date(now.getTime() - NUDGE_AFTER_HOURS * 3_600_000),
        gte: new Date(now.getTime() - NUDGE_GIVE_UP_HOURS * 3_600_000),
      },
      smsNudgedAt: null,
      respondedAt: null,
      status: 'NEW',
      source: { in: ['WEB_FORM', 'MANUAL'] },
    },
    select: {
      id: true,
      title: true,
      source: true,
      createdAt: true,
      smsNotifiedAt: true,
      company: { select: { name: true } },
      person: { select: { firstName: true, lastName: true } },
    },
    orderBy: { smsNotifiedAt: 'asc' },
    take: 25,
  })
  return rows
    .filter((r) => !EXCLUDED_TITLES.has(r.title.trim()))
    .map((r) => ({
      id: r.id,
      title: r.title,
      source: r.source,
      companyName: r.company?.name ?? null,
      personName: [r.person?.firstName, r.person?.lastName].filter(Boolean).join(' ').trim() || null,
      createdAt: r.createdAt,
      notifiedAt: r.smsNotifiedAt as Date,
    }))
}

/** Wes's number, or null with a reason worth logging. */
async function recipientPhone(): Promise<{ phone: string | null; reason?: string }> {
  const u = await prisma.user.findFirst({
    where: { email: NEW_INQUIRY_SMS_RECIPIENT, isActive: true },
    select: { phone: true },
  })
  if (!u) return { phone: null, reason: `no active user row for ${NEW_INQUIRY_SMS_RECIPIENT}` }
  if (!u.phone?.trim()) return { phone: null, reason: `no phone on file for ${NEW_INQUIRY_SMS_RECIPIENT}` }
  return { phone: u.phone.trim() }
}

export interface SweepResult {
  pending: number
  sent: boolean
  status?: string
  error?: string
  skipped?: string
  inquiryIds?: string[]
}

/**
 * One pass. Sends at most one text, then stamps the rows it covered.
 *
 * The stamp goes on AFTER a successful send, so a Twilio outage leaves the
 * queue intact and the next sweep retries — up to MAX_AGE_HOURS, after
 * which a lead that never texted is a lead someone has long since seen on
 * the board anyway.
 */
export async function sweepNewInquirySms(
  now: Date = new Date(),
  opts: { force?: boolean } = {},
): Promise<SweepResult> {
  const pending = await listPendingInquiries(now)
  if (pending.length === 0) return { pending: 0, sent: false, skipped: 'nothing pending' }
  if (!opts.force && !inTextingWindow(now)) {
    return { pending: pending.length, sent: false, skipped: `outside ${WINDOW_OPEN_HOUR}:00–${WINDOW_CLOSE_HOUR}:00 Pacific — held` }
  }

  const to = await recipientPhone()
  if (!to.phone) return { pending: pending.length, sent: false, skipped: to.reason ?? 'no recipient' }

  const r = await sendTracked({
    to: to.phone,
    body: composeAlert(pending, HQ_APP_URL),
    // 'staff' — an internal working alert to our own owner, not client
    // messaging. It is also what lets the 8am release fire on the boundary
    // rather than waiting out sendTracked's own quiet hours.
    source: 'staff',
  })
  if (!r.ok) return { pending: pending.length, sent: false, status: r.status, error: r.error }

  await prisma.inquiry.updateMany({
    where: { id: { in: pending.map((p) => p.id) } },
    data: { smsNotifiedAt: now },
  })
  return { pending: pending.length, sent: true, status: r.status, inquiryIds: pending.map((p) => p.id) }
}

/**
 * The follow-up pass. Same window, same batching, same stamp-after-send
 * discipline as the alert — and the stamp goes on whether or not a lead is
 * ever answered, so no inquiry can produce a second nudge.
 */
export async function sweepNewInquiryNudges(
  now: Date = new Date(),
  opts: { force?: boolean } = {},
): Promise<SweepResult> {
  const pending = await listPendingNudges(now)
  if (pending.length === 0) return { pending: 0, sent: false, skipped: 'nothing to nudge' }
  if (!opts.force && !inTextingWindow(now)) {
    return { pending: pending.length, sent: false, skipped: `outside ${WINDOW_OPEN_HOUR}:00–${WINDOW_CLOSE_HOUR}:00 Pacific — held` }
  }

  const to = await recipientPhone()
  if (!to.phone) return { pending: pending.length, sent: false, skipped: to.reason ?? 'no recipient' }

  // The oldest one sets the number in the sentence — "still unanswered
  // after N hours" should describe the worst case, not the newest arrival.
  const waitedHours = (now.getTime() - pending[0].notifiedAt.getTime()) / 3_600_000

  const r = await sendTracked({ to: to.phone, body: composeNudge(pending, HQ_APP_URL, waitedHours), source: 'staff' })
  if (!r.ok) return { pending: pending.length, sent: false, status: r.status, error: r.error }

  await prisma.inquiry.updateMany({
    where: { id: { in: pending.map((p) => p.id) } },
    data: { smsNudgedAt: now },
  })
  return { pending: pending.length, sent: true, status: r.status, inquiryIds: pending.map((p) => p.id) }
}

/**
 * A real text, to Wes, on demand — so outbound can be proved end to end
 * without waiting for a lead to walk in. Stamps nothing and invents no
 * Inquiry row; the link goes to the Incoming panel, which is always there.
 */
export async function sendNewInquirySmsTest(): Promise<{
  ok: boolean
  to?: string
  body?: string
  status?: string
  error?: string
}> {
  const to = await recipientPhone()
  if (!to.phone) return { ok: false, error: to.reason ?? 'no recipient' }
  const body = composeTestAlert(HQ_APP_URL)
  const r = await sendTracked({ to: to.phone, body, source: 'staff' })
  return { ok: r.ok, to: to.phone, body, status: r.status, error: r.error }
}
