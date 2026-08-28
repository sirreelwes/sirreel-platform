/**
 * First-response SLA for public web-form inquiries.
 *
 * The instant hq@ notification tells the client "an agent will follow
 * up shortly" — this constant defines how long "shortly" is allowed to
 * be before every surface starts flagging the inquiry as overdue:
 *   - the hourly safety-net email (api/cron/stale-inquiries, which
 *     reads INQUIRY_SAFETY_NET_HOURS server-side and defaults here)
 *   - the Action Items provider (inquiryUntouched)
 *   - the New inbound queue's red "no response" treatment
 *   - the sidebar Incoming pill
 *
 * Keep them agreeing: an email escalation the /jobs page doesn't also
 * show is exactly the gap this fixed (Wes 2026-08-28 — a 12h-old form
 * submission produced a safety-net email while /jobs said "all caught
 * up").
 */

export const INQUIRY_RESPONSE_SLA_HOURS = 3

interface SlaInput {
  source: string
  status?: string
  respondedAt: string | Date | null
  createdAt: string | Date
}

/** Hours (floored) this inquiry has waited with no staff response. */
export function inquiryWaitHours(row: Pick<SlaInput, 'createdAt'>, now = Date.now()): number {
  const created = new Date(row.createdAt).getTime()
  if (!Number.isFinite(created)) return 0
  return Math.max(0, Math.floor((now - created) / 3_600_000))
}

/**
 * True when a client submitted the public form and nobody has replied
 * within the SLA. Only WEB_FORM: Gmail/manual inquiries arrive through
 * channels where a reply may already exist outside HQ.
 */
export function inquiryPastResponseSla(row: SlaInput, slaHours = INQUIRY_RESPONSE_SLA_HOURS, now = Date.now()): boolean {
  if (row.source !== 'WEB_FORM') return false
  if (row.status && row.status !== 'NEW') return false
  if (row.respondedAt) return false
  return inquiryWaitHours(row, now) >= slaHours
}
