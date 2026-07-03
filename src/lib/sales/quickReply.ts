/**
 * Quick Reply — a fast availability-confirmation reply for inbound client
 * emails asking to hold trucks/supplies for a dated shoot, BEFORE a firm
 * quote.
 *
 * The client-facing availability verbiage is TWO-TIER, picked from live fleet
 * utilization (getCategoryUtilization — peak-day committed ÷ active):
 *
 *   positive      — every requested category (or the majority, when several)
 *                   is under the tight threshold for the dates
 *   noncommittal  — tight fleet, unparseable dates/categories, or a category
 *                   with zero active assets
 *
 * The email NEVER states counts, percentages, guarantees, or which categories
 * are tight — that detail is rep-only and surfaces in EmailReviewModal via the
 * preview endpoint. No quote PDF; just a warm acknowledgment + the tier
 * message + the supply-list link.
 *
 * `computeQuickReplyAvailability` (per-unit pooled counts from the scheduler's
 * engine) stays for the REP-facing surfaces: the Quick Reply modal's
 * availability pills and the soft-hold backup logic.
 */
import { getCategoryAvailability } from '@/lib/scheduling/availability'
import { getCategoryUtilization } from '@/lib/fleet/utilization'
import { buildTsxWelcomeEmail } from '@/lib/email/templates/tsxWelcomeTemplate'
import { SUPPLY_ORDER_URL } from '@/lib/email/supplyUrl'

// Re-exported for back-compat with existing importers; the canonical home is
// src/lib/email/supplyUrl.ts (orders.sirreel.com).
export const SUPPLIES_URL = SUPPLY_ORDER_URL

export interface QuickReplyCategoryInput {
  id: string
  name: string
  quantity: number
}

export interface QuickReplyLine {
  id: string
  name: string
  requested: number
  availableToHold: number
  serviceableCount: number
  status: 'available' | 'tight' | 'short'
}

function toDate(iso?: string | null): Date | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Per-category availability for the requested window, from the real engine.
 *  REP-FACING ONLY (modal pills + soft-hold backup ranking) — the client
 *  email no longer renders these counts. */
export async function computeQuickReplyAvailability(
  categories: QuickReplyCategoryInput[],
  pickup?: string | null,
  ret?: string | null,
): Promise<QuickReplyLine[]> {
  const start = toDate(pickup)
  const end = toDate(ret)
  const lines: QuickReplyLine[] = []
  for (const c of categories) {
    let availableToHold = 0
    let serviceableCount = 0
    if (start && end) {
      const a = await getCategoryAvailability(c.id, start, end, 1)
      availableToHold = Math.max(0, a.availableToHold)
      serviceableCount = a.serviceableCount
    }
    const requested = Math.max(1, Math.floor(c.quantity || 1))
    const status: QuickReplyLine['status'] =
      availableToHold >= requested ? 'available' : availableToHold <= 0 ? 'short' : 'tight'
    lines.push({ id: c.id, name: c.name, requested, availableToHold, serviceableCount, status })
  }
  return lines
}

// ── Two-tier availability verbiage (live fleet utilization) ─────────────────

/** Peak-day utilization at/over this → the category is "tight". */
export const UTILIZATION_TIGHT_THRESHOLD = 0.8

export type QuickReplyTier = 'positive' | 'noncommittal'

export interface QuickReplyUtilizationLine {
  id: string
  name: string
  requested: number
  activeAssets: number
  peakCommitted: number
  /** Peak-day committed ÷ active. null when the category has zero active assets. */
  utilization: number | null
  /** At/over threshold, or zero active assets. */
  tight: boolean
}

export interface QuickReplyTiering {
  tier: QuickReplyTier
  /** Both inquiry dates parsed to a valid window. */
  datesParsed: boolean
  /** Per-category utilization detail — rep-facing only, never emailed. */
  lines: QuickReplyUtilizationLine[]
}

export const QUICK_REPLY_POSITIVE_MESSAGE =
  "We're looking good on availability for your dates — send over your full job info and our team will confirm and get things rolling."

export const QUICK_REPLY_NONCOMMITTAL_MESSAGE =
  "Thanks for reaching out — we'd love to help with your job. Share your dates, location, and what you need, and our team will confirm availability and get everything rolling."

/**
 * Pick the reply tier from live fleet utilization.
 *
 * positive  ⇔ MORE THAN HALF of the requested categories are under the tight
 *             threshold (for a single category this is simply "under 0.80").
 *             Ties and zero-active categories count against.
 * noncommittal otherwise — including unparseable dates or no identifiable
 *             categories (nothing to measure).
 */
export async function computeQuickReplyTiering(
  categories: QuickReplyCategoryInput[],
  pickup?: string | null,
  ret?: string | null,
): Promise<QuickReplyTiering> {
  const start = toDate(pickup)
  const end = toDate(ret)
  const datesParsed = !!start && !!end && end >= start
  if (!start || !end || !datesParsed || categories.length === 0) {
    return { tier: 'noncommittal', datesParsed, lines: [] }
  }

  const lines: QuickReplyUtilizationLine[] = []
  for (const c of categories) {
    const u = await getCategoryUtilization(c.id, start, end)
    lines.push({
      id: c.id,
      name: c.name,
      requested: Math.max(1, Math.floor(c.quantity || 1)),
      activeAssets: u.activeAssets,
      peakCommitted: u.peakCommitted,
      utilization: u.utilization,
      tight: u.utilization === null || u.utilization >= UTILIZATION_TIGHT_THRESHOLD,
    })
  }

  const openCount = lines.filter((l) => !l.tight).length
  const tier: QuickReplyTier = openCount > lines.length - openCount ? 'positive' : 'noncommittal'
  return { tier, datesParsed, lines }
}

export function tierMessage(tier: QuickReplyTier): string {
  return tier === 'positive' ? QUICK_REPLY_POSITIVE_MESSAGE : QUICK_REPLY_NONCOMMITTAL_MESSAGE
}

function fmtDate(iso?: string | null): string | null {
  const d = toDate(iso ?? null)
  if (!d) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export interface ComposeQuickReplyArgs {
  recipientName?: string | null
  clientName?: string | null
  jobName?: string | null
  pickup?: string | null
  ret?: string | null
  /** Tier picked from live fleet utilization (computeQuickReplyTiering). */
  tiering: QuickReplyTiering
  agentName: string
  personalNote?: string | null
  /** Fold a request for the production company + project name into the reply. */
  askForDetails?: boolean
  /** Rep's own message — replaces the templated prose; the branded shell, the
   *  tier availability message + supply CTA, and the sign-off stay intact. */
  customMessage?: string | null
}

export function composeQuickReply(args: ComposeQuickReplyArgs): { subject: string; html: string; text: string } {
  const job = args.jobName || args.clientName || 'your shoot'
  const start = fmtDate(args.pickup)
  const end = fmtDate(args.ret)
  const dateRange = start && end ? `${start} – ${end}` : start ? `starting ${start}` : null

  // Reuse Send Quote's branded shell (buildTsxWelcomeEmail) in 'availability'
  // mode — one template, both flows. The supply link renders as a styled
  // button inside the shell; the tier message is the ONLY availability
  // statement in the email — no counts, no category names.
  return buildTsxWelcomeEmail({
    mode: 'availability',
    clientFirstName: args.recipientName ?? null,
    clientFullName: args.recipientName ?? null,
    agentName: args.agentName,
    agentEmail: '',
    agentPhone: null,
    personalNote: args.personalNote ?? null,
    quote: null,
    // Ask only for the field(s) we actually lack (computed from the current,
    // possibly rep-typed, values) — never ask for a company/job we already have.
    availability: {
      jobName: job,
      dateRange,
      availabilityMessage: tierMessage(args.tiering.tier),
      // Non-committal opens with its own "Thanks for reaching out" — it IS
      // the opener. Positive keeps the templated opener and adds the message.
      messageReplacesOpener: args.tiering.tier === 'noncommittal',
      suppliesUrl: SUPPLY_ORDER_URL,
      askForCompany: !!args.askForDetails && !args.clientName?.trim(),
      askForJob: !!args.askForDetails && !args.jobName?.trim(),
      customBody: args.customMessage ?? null,
    },
  })
}
