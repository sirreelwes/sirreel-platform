/**
 * Scheduling status tokens — THE single source of truth for every color,
 * label, and legend entry on the reservations surfaces (gantt, calendar,
 * dispatch-linker, scheduling modals, timeline-native payload).
 *
 * Born 2026-08-21 (Phase 1 of the team rollout): these colors were
 * previously retyped in ~12 files with three conflicting palettes —
 * "booked" was green on the gantt, blue on the calendar, emerald on the
 * linker — and the gantt legend was hand-typed literals that could drift
 * from the bars. Every consumer now imports from here; the legend
 * component (components/scheduling/StatusLegend.tsx) derives its
 * swatches from these same constants so it CANNOT drift.
 *
 * Design contract (Wes, 2026-08-21 — matched to the Planyo look the
 * team knows, with our own semantics):
 * · green  = booked/confirmed (same instinct as Planyo)
 * · blue = hold/reserved, pending  (same instinct as Planyo)
 * · dark red = booked with an Order attached (Planyo "ORDER ATTACHED")
 * · GREY UNIQUELY MEANS MAINTENANCE / unit out of service. Nothing
 * else may render grey-filled — cancelled is a struck outline.
 * · inquiry = dashed outline ("not real yet") — kills the old
 * pale-green vs dark-green misread.
 * · backups stay the faded dashed-blue sub-lane (our model replaces
 * Planyo's "X - 2ND HOLD" placeholder hack).
 * · yellow is reserved for the ART DEPT job tag (Planyo's yellow),
 * which is a TAG, not a status.
 */

export type BarColor = { bg: string; border: string; text: string }

/**
 * Display-token → gantt bar color. Keys are the tokens mapStatus() in
 * /api/timeline-native emits (inquiry | hold | booked | cancelled) —
 * NOT raw Prisma BookingStatus. Unknown tokens fall back to `booked`.
 */
export const STATUS_COLORS: Record<string, BarColor> = {
  // Quote sent / availability confirmed, no hold yet. Dashed outline =
  // "not real yet"; the grid shows through on purpose.
  inquiry: { bg: 'bg-transparent', border: 'border-dashed border-green-600', text: 'text-green-800' },
  // AI_REVIEW / PENDING_APPROVAL.
  hold: { bg: 'bg-blue-500', border: 'border-blue-600', text: 'text-white' },
  // CONFIRMED / ACTIVE / RETURNED / ARCHIVED.
  booked: { bg: 'bg-green-600', border: 'border-green-700', text: 'text-white' },
  // Struck neutral OUTLINE — deliberately not grey-filled (grey is
  // maintenance-only). `line-through` rides in `text` because that class
  // lands on the bar's label span.
  cancelled: { bg: 'bg-transparent', border: 'border-gray-300', text: 'text-gray-400 line-through' },
}

/**
 * A BOOKED bar whose reservation has an Order attached — Planyo's
 * "ORDER ATTACHED" dark red, the team's strongest color habit. The
 * marker stays alongside; color makes it readable across the room.
 */
export const ORDER_ATTACHED_COLOR: BarColor = { bg: 'bg-[#b04a5a]', border: 'border-[#93394a]', text: 'text-white' }

/** A BOOKED bar whose linked order is flagged blind pickup. Wins over order-attached red — it's the day-of-operations alert. */
export const BLIND_PICKUP_COLOR: BarColor = { bg: 'bg-violet-500', border: 'border-violet-600', text: 'text-white' }

/** Unit N/A (open maintenance window). The ONLY grey-filled bar on the board. */
export const UNIT_NA_COLOR: BarColor = { bg: 'bg-gray-400', border: 'border-gray-500', text: 'text-white' }

/**
 * Bar color resolver. Precedence on booked bars:
 * blind pickup (violet) > order attached (dark red) > plain booked green.
 */
export function barColor(status: string, opts?: { blindPickup?: boolean; hasOrder?: boolean }): BarColor {
  if (status === 'booked' && opts?.blindPickup) return BLIND_PICKUP_COLOR
  if (status === 'booked' && opts?.hasOrder) return ORDER_ATTACHED_COLOR
  return STATUS_COLORS[status] || STATUS_COLORS.booked
}

/**
 * Light "chip" variant of the same semantics for pill/badge surfaces
 * (calendar month grid, dispatch-linker, list chips) where a solid bar
 * would shout. Same hue story as STATUS_COLORS.
 */
export const STATUS_CHIPS: Record<string, string> = {
  inquiry: 'bg-transparent text-green-800 border border-dashed border-green-500',
  hold: 'bg-blue-100 text-blue-800 border border-blue-200',
  booked: 'bg-green-100 text-green-800 border border-green-200',
  cancelled: 'bg-transparent text-gray-400 line-through border border-gray-300',
}

/** ART DEPT job tag — Planyo's yellow, carried into HQ as a TAG (not a status). */
export const ART_DEPT_TAG_CHIP = 'bg-yellow-300 text-yellow-950 border border-yellow-400'

/** Unit availability states (lib/scheduling/availability UnitState) — a different axis than booking status. */
export const UNIT_STATE_BADGE: Record<'free' | 'buffer' | 'booked', string> = {
  free: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  buffer: 'bg-amber-50 text-amber-800 border-amber-200',
  booked: 'bg-rose-50 text-rose-700 border-rose-200',
}
export const UNIT_STATE_LABEL: Record<'free' | 'buffer' | 'booked', string> = {
  free: 'available',
  buffer: 'tight',
  booked: 'booked',
}

/** Condition tier → left-of-name dot (Asset.tier). Wes's mapping: Best=green, Good=orange, Workhorse=yellow. */
export const TIER_COLORS: Record<string, string> = {
  PREMIUM: '#22c55e',
  STANDARD: '#f97316',
  ECONOMY: '#eab308',
}
export const TIER_LABELS: Record<string, string> = {
  PREMIUM: 'Best',
  STANDARD: 'Good',
  ECONOMY: 'Workhorse',
}
export const TIER_ORDER = ['PREMIUM', 'STANDARD', 'ECONOMY'] as const

/**
 * Category short-key → color. The palette the team has stared at since
 * the Planyo-fed board — carried forward verbatim. Used by the gantt,
 * the dashboard category tiles, AND /api/timeline-native (which embeds
 * the hex in its payload).
 */
export const CAT_COLORS: Record<string, string> = {
  cube: '#3b82f6',
  cargo: '#8b5cf6',
  pass: '#06b6d4',
  pop: '#f59e0b',
  cam: '#ec4899',
  dlux: '#10b981',
  scout: '#f97316',
  studio: '#6366f1',
  stakebed: '#78716c',
  general: '#9ca3af',
}
export const CAT_LABELS: Record<string, string> = {
  cube: 'Cube',
  cargo: 'Cargo',
  pass: 'Pass Van',
  pop: 'PopVan',
  cam: 'Cam Cube',
  dlux: 'DLUX',
  scout: 'Scout',
  studio: 'Studio',
  stakebed: 'Stakebed',
  general: 'Other',
}

/** Today-column tint — Planyo's peach "you are here" column. Header cell + full-height column overlay. */
export const TODAY_COLUMN_TINT = 'bg-orange-100/50'
export const TODAY_HEADER_CLASS = 'bg-orange-100 font-bold text-orange-700'

/**
 * Legend rows, DERIVED from the constants above — the legend component
 * renders these, so a color change here changes bars and legend
 * together. `swatch` is a full className for the little rectangle.
 */
export const LEGEND_ITEMS: Array<{ label: string; swatch: string; struck?: boolean }> = [
  { label: 'Inquiry', swatch: `${STATUS_COLORS.inquiry.bg} border ${STATUS_COLORS.inquiry.border}` },
  { label: 'Hold', swatch: `${STATUS_COLORS.hold.bg} border ${STATUS_COLORS.hold.border}` },
  { label: 'Booked', swatch: `${STATUS_COLORS.booked.bg} border ${STATUS_COLORS.booked.border}` },
  { label: 'Booked · Order attached', swatch: `${ORDER_ATTACHED_COLOR.bg} border ${ORDER_ATTACHED_COLOR.border}` },
  { label: 'Booked · Blind Pickup', swatch: `${BLIND_PICKUP_COLOR.bg} border ${BLIND_PICKUP_COLOR.border}` },
  { label: 'Cancelled', swatch: `${STATUS_COLORS.cancelled.bg} border ${STATUS_COLORS.cancelled.border}`, struck: true },
  { label: 'Maintenance / Unit N/A', swatch: `${UNIT_NA_COLOR.bg} border ${UNIT_NA_COLOR.border}` },
  { label: 'Backup (queued)', swatch: 'bg-blue-200/70 border border-dashed border-blue-400' },
]

/* ────────────────────────────────────────────────────────────────────
 * Readiness meter (Wes 2026-09-09) — "could holds start out as an
 * outline when quoted, then slowly fill as items are done: client
 * accepts, COI, RA, CCA, driver info… and turn full green when all
 * necessary items are met?"
 *
 * Rendered as a 5px SEGMENTED rail along the bar's bottom edge, not as a
 * wash across the bar body, for two reasons that both bit on the mockup:
 *
 *  1. The gantt's horizontal axis is TIME. A bar filled 60% from the left
 *     reads as "confirmed through Wednesday, tentative after" — a real
 *     misread on a board people scan against the date header. Hard
 *     notches at every step boundary are what defuse it: five ticked
 *     boxes are a count, a smooth fill is a position.
 *  2. Bar labels are 9px white-on-colour. A light-green wash across the
 *     body puts white text on mint and the client name stops being
 *     readable — the same failure as the 2026-09-04 check in/out screen.
 *
 * It is a background-image, not a child element, so it needs no z-index
 * against the label and no DOM on 300+ bars.
 *
 * The five steps are computeReadiness's (COI · agreement · card · driver ·
 * gear) — see src/lib/jobs/readiness.ts. "Client accepts" is deliberately
 * NOT one of them: on this board it is already the bar's own colour
 * transition, dashed inquiry → blue hold → green booked.
 */
import type { CSSProperties } from 'react'

/** Filled step. Two greens, and the split is not cosmetic: green-500 on a
 *  BOOKED bar is green-on-green and disappears — which is the one bar where
 *  an unmet check matters most (booked, no COI, out on Thursday). The light
 *  green reads on every solid bar we paint: blue hold, booked green, the
 *  order-attached red, the blind-pickup violet. */
const METER_FILL_ON_DARK = '#86efac'
const METER_FILL_ON_LIGHT = '#16a34a'
/** Unfilled track. Dark on solid bars so the empty steps read as a groove
 *  cut into the bar rather than as more bar. */
const METER_TRACK_ON_DARK = 'rgba(0,0,0,0.30)'
const METER_TRACK_ON_LIGHT = 'rgba(0,0,0,0.13)'
const METER_NOTCH_ON_DARK = 'rgba(0,0,0,0.55)'
const METER_NOTCH_ON_LIGHT = 'rgba(255,255,255,0.85)'
/** Rail height. 5px of a 24px bar — a strong horizontal line at desk
 *  distance without taking room from the 9px label. The compact variant is
 *  for the 18px "needs a unit" chips, where 5px is a quarter of the chip. */
const METER_HEIGHT = '5px'
const METER_HEIGHT_COMPACT = '3px'

/**
 * Style for the bottom rail. Spread onto the bar's existing inline style.
 * `light` for bars whose own surface is pale or transparent (backup
 * sub-lane, dashed inquiry outline) so the empty track stays visible;
 * `compact` for the short "needs a unit" chips.
 */
export function readinessMeterStyle(
  done: number,
  total: number,
  opts?: { light?: boolean; compact?: boolean },
): CSSProperties {
  const steps = Math.max(1, total)
  const pct = Math.max(0, Math.min(1, done / steps)) * 100
  const step = 100 / steps
  const light = opts?.light === true
  const track = light ? METER_TRACK_ON_LIGHT : METER_TRACK_ON_DARK
  const fill = light ? METER_FILL_ON_LIGHT : METER_FILL_ON_DARK
  const notch = light ? METER_NOTCH_ON_LIGHT : METER_NOTCH_ON_DARK
  return {
    backgroundImage: [
      // Notches first so they paint ON TOP of the fill.
      `repeating-linear-gradient(to right, transparent 0 calc(${step}% - 1px), ${notch} calc(${step}% - 1px) ${step}%)`,
      `linear-gradient(to right, ${fill} 0 ${pct}%, ${track} ${pct}% 100%)`,
    ].join(', '),
    backgroundSize: `100% ${opts?.compact ? METER_HEIGHT_COMPACT : METER_HEIGHT}`,
    backgroundPosition: 'left bottom',
    backgroundRepeat: 'no-repeat',
  }
}

/** Hover text — "Ready to go out" or "3 of 5 · missing COI, Card". */
export function readinessMeterTitle(r: {
  done: number
  total: number
  ready: boolean
  blockers: { label: string }[]
}): string {
  if (r.ready) return 'Ready to go out — COI · agreement · card · driver · gear'
  return `${r.done} of ${r.total} ready · still needed: ${r.blockers.map((b) => b.label).join(', ')}`
}
