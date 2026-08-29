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
import { schedulingCategoryId } from '@/lib/catalog/resolve'
import { STANDARD_OPENING_LINE } from '@/lib/email/standardOpening'
import { getCategoryUtilization } from '@/lib/fleet/utilization'
import { buildWelcomeEmail } from '@/lib/email/templates/welcomeTemplate'
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
      // The modal's lines come off parse-quote's `matchedProduct.id`, which is
      // a MERGED catalog (InventoryItem) id; the availability engine is keyed
      // on the legacy AssetCategory id. Unnormalized, every AI-parsed vehicle
      // line matched zero Assets and read "0 of 0 open · Spoken for" with the
      // whole fleet sitting free.
      const a = await getCategoryAvailability(await schedulingCategoryId(c.id), start, end, 1)
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

/**
 * The ONE standard sentence every quick reply opens with (Wes, 2026-08-12).
 *
 * Both tiers say the same thing to the client on purpose. The old copy
 * differed by tier — "we're looking good on availability" vs a hedge — which
 * made the template commit, or decline to commit, on the rep's behalf before
 * anyone had looked at the job. Specifics belong in the rep's own words
 * underneath.
 *
 * The tier is still computed and still shown to the REP in the review modal;
 * it just no longer writes the client-facing line.
 */
export const QUICK_REPLY_STANDARD_MESSAGE = STANDARD_OPENING_LINE

/** Kept as named exports so existing call sites (AI review prompt) keep
 *  working — both now resolve to the same standard sentence. */
export const QUICK_REPLY_POSITIVE_MESSAGE = QUICK_REPLY_STANDARD_MESSAGE

export const QUICK_REPLY_NONCOMMITTAL_MESSAGE = QUICK_REPLY_STANDARD_MESSAGE

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

/**
 * "Aug 28 – Aug 30, 2026" for the hold acknowledgement, or null when no hold
 * was placed. A single-day hold reads as one date rather than "X – X".
 */
export function holdRangeLabel(from?: string | null, to?: string | null): string | null {
  const start = toDate(from ?? null)
  const end = toDate(to ?? null)
  if (!start || !end) return null
  const a = fmtDate(from)
  const b = fmtDate(to)
  if (!a || !b) return null
  if (a === b) return a
  // "Aug 28 – Aug 30, 2026" rather than repeating the year on both sides;
  // across a year boundary both years are kept.
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear()
  return sameYear ? `${a.replace(/,\s*\d{4}$/, '')} – ${b}` : `${a} – ${b}`
}

function fmtDate(iso?: string | null): string | null {
  const d = toDate(iso ?? null)
  if (!d) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

// ── What the client actually asked for ──────────────────────────────────────

/**
 * One requested line — a holdable category (vehicle / stage) or a supply
 * that rides along on the truck.
 *
 * Supplies are NOT holdable: expendables live in InventoryItem with no Asset
 * units behind them, so the scheduler has nothing to reserve against them
 * (see /api/scheduling/categories). They still have to travel with the
 * request — "10 ratchet straps and a dozen furniture pads on the cargo van"
 * is the most ordinary inquiry we get, and dropping it silently was how the
 * straps vanished between the client's email and the reply (Wes 2026-08-26).
 */
export interface QuickReplyItemLine {
  name: string
  quantity: number
  /** Per-line window. Only rendered when the request spans more than one. */
  startDate?: string | null
  endDate?: string | null
}

/**
 * "2 × Cube Truck" / "Cargo Van w/ Liftgate" (a single unit reads as the bare
 * name).
 *
 * The quantity here is the CLIENT'S OWN number echoed back to them, which is
 * why it doesn't violate the no-counts rule the rest of this file enforces:
 * that rule is about OUR fleet numbers (how many units exist, how booked they
 * are), and those stay rep-only.
 */
export function itemLabel(item: QuickReplyItemLine, window?: string | null): string {
  const qty = Math.max(1, Math.floor(item.quantity || 1))
  const base = qty > 1 ? `${qty} × ${item.name}` : item.name
  return window ? `${base} · ${window}` : base
}

/**
 * Render the requested lines for the client email.
 *
 * Dates are appended per line ONLY when the request covers more than one
 * window — a van from the 27th and a box truck from the 29th need saying;
 * repeating one shared range on every line is noise, the sentence around the
 * list already carries it.
 */
export function requestedItemLabels(items: QuickReplyItemLine[]): string[] {
  const windows = new Set(
    items.filter((i) => i.startDate && i.endDate).map((i) => `${i.startDate}|${i.endDate}`),
  )
  const perLineWindows = windows.size > 1
  return items
    .filter((i) => i.name?.trim())
    .map((i) => itemLabel(i, perLineWindows ? holdRangeLabel(i.startDate, i.endDate) : null))
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
  /** Resolved by the send/preview route via buildDetailsLink — the one-tap
   *  page carrying the two fields. Null keeps the plain "just reply" ask. */
  detailsUrl?: string | null
  /** Set only when a soft hold was actually created — the window; the units
   *  themselves come from `categories` below. */
  heldFrom?: string | null
  heldTo?: string | null
  /** The vehicle/stage categories the reply is about. Named in the email so
   *  the client can see we read the request right (Wes 2026-08-26 — a hold
   *  confirmation that says only "your equipment" tells them nothing). */
  categories?: QuickReplyItemLine[]
  /** Supplies / gear asked for on the vehicle. Not holdable, still promised. */
  supplies?: QuickReplyItemLine[]
  /** Rep's own message — replaces the templated prose; the branded shell, the
   *  tier availability message + supply CTA, and the sign-off stay intact. */
  customMessage?: string | null
}

export function composeQuickReply(args: ComposeQuickReplyArgs): { subject: string; html: string; text: string } {
  const job = args.jobName || args.clientName || 'your shoot'
  const start = fmtDate(args.pickup)
  const end = fmtDate(args.ret)
  const dateRange = start && end ? `${start} – ${end}` : start ? `starting ${start}` : null

  // Reuse Send Quote's branded shell (buildWelcomeEmail) in 'availability'
  // mode — one template, both flows. The supply link renders as a styled
  // button inside the shell; the tier message is the ONLY availability
  // statement in the email — no counts, no category names.
  return buildWelcomeEmail({
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
      heldRange: holdRangeLabel(args.heldFrom, args.heldTo),
      requestedItems: requestedItemLabels(args.categories ?? []),
      supplyItems: requestedItemLabels(args.supplies ?? []),
      askForCompany: !!args.askForDetails && !args.clientName?.trim(),
      askForJob: !!args.askForDetails && !args.jobName?.trim(),
      detailsUrl: args.detailsUrl ?? null,
      customBody: args.customMessage ?? null,
    },
  })
}
