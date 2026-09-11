/**
 * THE DISCOUNT WATERFALL — what a client discount on a partner's unit does
 * to the deal.
 *
 * Wes 2026-09-11 (VSM Planet): "VSM Planet automatically gives us 35% off,
 * but is willing to go to 40-43% off to keep a client … We must protect a
 * minimum of 10% to SirReel. It should gradually move to that, first sharing
 * the added discount until VSM hits their maximum discount and then go
 * pulling from our share after up until we hit that 10% floor." And: "if the
 * client asks for 35% off, we should decline."
 *
 * Before this the partner was paid list × (1 − share) whatever the client
 * paid, so every discount came out of SirReel alone: 30% off a 30% deal made
 * SirReel nothing, and anything deeper cost money.
 *
 * On a $1,000 list — VSM's deal 35%, their maximum 43%, SirReel's floor 10%:
 *
 *   client discount   client pays   VSM gets   SirReel keeps
 *         0%            $1,000        $650        $350
 *        10%              $900        $600        $300    shared 50/50
 *        16%              $840        $570        $270    VSM reaches 43%
 *        30%              $700        $570        $130    SirReel alone
 *        33%              $670        $570        $100    the floor
 *        35%            declined — SirReel would keep $80
 *
 *   1. SHARED   the discount is split equally until the partner's share has
 *               moved from their deal to their maximum
 *               (Vendor.partnerMaxSharePercent).
 *   2. SIRREEL  past that, SirReel alone gives until it keeps its floor.
 *   3. DECLINED anything deeper is refused.
 *
 * The floor is a share of LIST, not of what the client pays. 10% of the
 * billed price would let 35% through on VSM's numbers (the floor would sit at
 * $63), and Wes's own example declines it.
 *
 * A partner with no maximum gives nothing beyond their deal, so rule 1 is
 * skipped. A deal already thinner than the floor leaves SirReel no room, so
 * the partner covers the discount alone — still never past their maximum.
 *
 * Pure: no Prisma. The database half (loading an order, the edit gate, the
 * vendor-cost stamp) is partnerMargins.ts.
 */
import { computeOrderTotals, type DiscountForTotals, type LineForTotals } from '@/lib/orders/discountedTotals'

/** SirReel's minimum on a partner unit, as a percent of the partner's list. */
export const SIRREEL_FLOOR_PERCENT = 10

const EPS = 0.005
const round2 = (n: number): number => Math.round(n * 100) / 100
const pct = (n: number | null | undefined): number => Math.max(0, Math.min(100, Number(n) || 0))

export type WaterfallStage = 'none' | 'shared' | 'sirreel' | 'declined'

export interface Waterfall {
  list: number
  billed: number
  /** list − billed, never negative (a price above list is not a discount). */
  discount: number
  discountPercent: number
  partnerPay: number
  sirreelKeep: number
  sirreelFloor: number
  /** SirReel's share of list once the partner's part of the discount is in.
   *  What the partner is paid on: list × (1 − effectiveShare). */
  effectiveSharePercent: number
  /** Points of list the partner gave beyond their deal to keep this client. */
  concessionPercent: number
  /** The deepest discount this deal allows before it is declined. */
  maxDiscountPercent: number
  /** The lowest price the client can pay. */
  minBilled: number
  stage: WaterfallStage
  allowed: boolean
}

export function discountWaterfall(a: {
  list: number
  billed: number
  sharePercent: number
  maxSharePercent?: number | null
  floorPercent?: number
}): Waterfall {
  const list = Math.max(0, a.list)
  const billed = Math.max(0, a.billed)
  const share = pct(a.sharePercent)
  const maxShare = Math.max(share, a.maxSharePercent == null ? share : pct(a.maxSharePercent))
  const floorPct = pct(a.floorPercent ?? SIRREEL_FLOOR_PERCENT)

  const partnerBase = (list * (100 - share)) / 100
  const partnerRoom = (list * (maxShare - share)) / 100
  const sirreelBase = (list * share) / 100
  const sirreelFloor = (list * floorPct) / 100
  const sirreelRoom = Math.max(0, sirreelBase - sirreelFloor)

  const discount = Math.max(0, list - billed)
  // Half each, the partner's half capped at their room…
  let partnerCut = Math.min(discount / 2, partnerRoom)
  // …and where SirReel's half would breach its floor, the partner's room
  // (never more) covers the shortfall.
  if (discount - partnerCut > sirreelRoom + EPS) partnerCut = Math.min(partnerRoom, discount - sirreelRoom)
  const sirreelCut = discount - partnerCut
  const allowed = sirreelCut <= sirreelRoom + EPS

  const partnerPay = partnerBase - partnerCut
  const stage: WaterfallStage =
    discount < EPS ? 'none' : !allowed ? 'declined' : partnerCut < partnerRoom - EPS ? 'shared' : 'sirreel'

  return {
    list: round2(list),
    billed: round2(billed),
    discount: round2(discount),
    discountPercent: list > 0 ? round2((discount / list) * 100) : 0,
    partnerPay: round2(partnerPay),
    sirreelKeep: round2(billed - partnerPay),
    sirreelFloor: round2(sirreelFloor),
    effectiveSharePercent: list > 0 ? round2((1 - partnerPay / list) * 100) : share,
    concessionPercent: list > 0 ? round2((partnerCut / list) * 100) : 0,
    maxDiscountPercent: list > 0 ? round2(((partnerRoom + sirreelRoom) / list) * 100) : 0,
    minBilled: round2(list - partnerRoom - sirreelRoom),
    stage,
    allowed,
  }
}

/** For staff setting a deal (Portals): the waterfall told on a $1,000 list.
 *  Names SirReel's floor, so it is never shown to a partner. */
export function describeDeal(sharePercent: number, maxSharePercent: number | null, floorPercent = SIRREEL_FLOOR_PERCENT): string {
  const at = (off: number) => discountWaterfall({ list: 1000, billed: 1000 - off * 10, sharePercent, maxSharePercent, floorPercent })
  const usd0 = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  const w0 = at(0)
  const out = [`On a $1,000 list they get ${usd0(w0.partnerPay)} and SirReel keeps ${usd0(w0.sirreelKeep)}.`]
  if (w0.maxDiscountPercent <= 0) {
    out.push(`No client discount fits — SirReel is at its ${floorPercent}% floor and they give nothing further.`)
    return out.join(' ')
  }
  const flex = maxSharePercent != null && maxSharePercent > sharePercent ? maxSharePercent - sharePercent : 0
  const sirreelRoom = Math.max(0, sharePercent - floorPercent)
  if (flex > 0 && sirreelRoom >= flex) {
    const until = round2(flex * 2)
    const s = at(until)
    out.push(`A client discount is shared equally up to ${until}% off (${usd0(s.partnerPay)} / ${usd0(s.sirreelKeep)}), then comes out of SirReel’s share.`)
  } else if (flex > 0) {
    out.push(`SirReel’s share is already near its floor, so they cover most of a client discount, up to their ${maxSharePercent}%.`)
  } else {
    out.push('They don’t flex, so a client discount comes out of SirReel’s share alone.')
  }
  out.push(`Deepest client discount: ${w0.maxDiscountPercent}% off (${usd0(w0.minBilled)}); deeper is refused.`)
  return out.join(' ')
}

// ── The order: which part of each discount lands on a partner line ─────────

export interface PartnerLineInput {
  lineId: string
  subRentalId: string
  department: LineForTotals['department']
  quantity: number
  /** Null = dates TBD; the line is then judged per day at its rate. */
  billableDays: number | null
  rate: number
  lineTotal: number
  vendorName: string
  unitName: string
  /** The partner's listed daily rate for the unit. */
  listDaily: number | null
  /** Unit override first, then the vendor's deal (effectiveSharePercent). */
  sharePercent: number | null
  maxSharePercent: number | null
  /** A daily rate already stamped on the booking — the partner has been told
   *  this number, so it is what they are owed whatever the deal says. */
  committedDaily: number | null
}

export type PartnerMarginStatus = 'ok' | 'declined' | 'no-deal' | 'no-list'

export interface PartnerLineMargin {
  lineId: string
  subRentalId: string
  vendorName: string
  unitName: string
  status: PartnerMarginStatus
  /** days × quantity the money is spread over. */
  units: number
  /** The deal's answer. Null when there is no deal or no list rate. */
  waterfall: Waterfall | null
  /** What is actually owed and kept — the waterfall, or the committed
   *  number when the partner has already been told one. */
  partnerPay: number | null
  sirreelKeep: number | null
  committed: boolean
}

export interface MarginInputs {
  taxRate: number
  /** Every line on the order — the discounts spread over all of them. */
  lines: (LineForTotals & { id: string })[]
  discounts: DiscountForTotals[]
  partnerLines: PartnerLineInput[]
}

/**
 * The fraction of a line's own total that the department and order
 * discounts take, using the same breakdown every renderer prints. A
 * PERCENT row still applies to an undated (zero-total) line; a FIXED row has
 * nothing to spread over there.
 */
function discountFractions(inputs: MarginInputs) {
  const b = computeOrderTotals({ lines: inputs.lines, discounts: inputs.discounts, taxRate: inputs.taxRate })
  const rowFor = (scope: 'ORDER' | 'DEPARTMENT', dept?: string) =>
    inputs.discounts.find((d) => d.scope === scope && (scope === 'ORDER' || d.departmentKey === dept)) ?? null
  const asPercent = (row: DiscountForTotals | null) => (row && row.type === 'PERCENT' ? Math.min(1, Number(row.value) / 100) : 0)

  const dept = new Map<string, number>()
  for (const d of b.byDepartment) {
    if (d.department === 'EXPENDABLES') continue
    dept.set(d.department, d.lineSubtotal > 0 ? d.discount / d.lineSubtotal : asPercent(rowFor('DEPARTMENT', d.department)))
  }
  const order = b.discountableSubtotal > 0 ? b.orderDiscount / b.discountableSubtotal : asPercent(rowFor('ORDER'))
  return { dept, order }
}

export function evaluatePartnerLines(inputs: MarginInputs, floorPercent = SIRREEL_FLOOR_PERCENT): PartnerLineMargin[] {
  if (inputs.partnerLines.length === 0) return []
  const f = discountFractions(inputs)
  return inputs.partnerLines.map((p) => {
    const units = Math.max(1, (p.billableDays ?? 1) * Math.max(1, p.quantity))
    const base = { lineId: p.lineId, subRentalId: p.subRentalId, vendorName: p.vendorName, unitName: p.unitName, units }
    if (p.sharePercent == null) return { ...base, status: 'no-deal', waterfall: null, partnerPay: null, sirreelKeep: null, committed: false }
    if (p.listDaily == null || p.listDaily <= 0) return { ...base, status: 'no-list', waterfall: null, partnerPay: null, sirreelKeep: null, committed: false }

    const gross = p.billableDays == null ? p.rate * Math.max(1, p.quantity) : p.lineTotal
    const fromDiscounts = p.department === 'EXPENDABLES' ? 1 : (1 - (f.dept.get(p.department) ?? 0)) * (1 - f.order)
    const billed = gross * fromDiscounts
    const list = p.listDaily * units
    const w = discountWaterfall({ list, billed, sharePercent: p.sharePercent, maxSharePercent: p.maxSharePercent, floorPercent })

    if (p.committedDaily == null) {
      return { ...base, status: w.allowed ? 'ok' : 'declined', waterfall: w, partnerPay: w.partnerPay, sirreelKeep: w.sirreelKeep, committed: false }
    }
    // Already told a number: SirReel absorbs any later discount, down to its
    // floor — or, on a deal thinner than the floor, down to nothing further.
    const partnerPay = round2(p.committedDaily * units)
    const keep = round2(w.billed - partnerPay)
    const threshold = Math.min(w.sirreelFloor, round2(list - partnerPay))
    const allowed = keep >= threshold - EPS
    return { ...base, status: allowed ? 'ok' : 'declined', waterfall: w, partnerPay, sirreelKeep: keep, committed: true }
  })
}

// ── A proposed edit, and whether it makes things worse ──────────────────────

export interface MarginChange {
  line?: { id: string; lineTotal: number; billableDays?: number | null; quantity?: number; rate?: number }
  /** `next: null` removes the row with `id`; otherwise it replaces the row
   *  with `id`, or the row it would collide with (one ORDER row, one per
   *  department). */
  discount?: { id?: string; next: DiscountForTotals | null }
}

export function applyMarginChange(inputs: MarginInputs, change: MarginChange | undefined): MarginInputs {
  if (!change) return inputs
  let { lines, discounts, partnerLines } = inputs
  const l = change.line
  if (l) {
    lines = lines.map((x) => (x.id === l.id ? { ...x, lineTotal: l.lineTotal } : x))
    partnerLines = partnerLines.map((p) =>
      p.lineId === l.id
        ? { ...p, lineTotal: l.lineTotal, billableDays: l.billableDays !== undefined ? l.billableDays : p.billableDays, quantity: l.quantity ?? p.quantity, rate: l.rate ?? p.rate }
        : p,
    )
  }
  const d = change.discount
  if (d) {
    const next = d.next
    discounts = discounts.filter((x) => {
      if (d.id && x.id === d.id) return false
      if (next && x.scope === next.scope && (next.scope === 'ORDER' || x.departmentKey === next.departmentKey)) return false
      return true
    })
    if (next) discounts = [...discounts, next]
  }
  return { ...inputs, lines, discounts, partnerLines }
}

/**
 * The lines an edit pushes past the floor: newly declined, or declined
 * before and SirReel keeps even less now. An order already over the line
 * (a list rate moved, a deal changed) can still be edited in the right
 * direction — nobody is stopped from giving less away.
 */
export function floorBreaches(before: PartnerLineMargin[], after: PartnerLineMargin[]): PartnerLineMargin[] {
  const prev = new Map(before.map((m) => [m.subRentalId, m]))
  return after.filter((m) => {
    if (m.status !== 'declined') return false
    const b = prev.get(m.subRentalId)
    if (!b || b.status !== 'declined') return true
    return (m.sirreelKeep ?? 0) < (b.sirreelKeep ?? 0) - EPS
  })
}

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

/** Staff-facing — names the partner, so it never reaches a client. */
export function floorMessage(breaches: PartnerLineMargin[], floorPercent = SIRREEL_FLOOR_PERCENT): string {
  const [m, ...rest] = breaches
  if (!m || !m.waterfall) return ''
  const w = m.waterfall
  const owed = m.committed ? `${m.vendorName} has already been told ${usd(m.partnerPay ?? 0)}` : `${m.vendorName} is owed ${usd(m.partnerPay ?? 0)}`
  const deepest = m.committed
    ? ''
    : ` The deepest discount this unit allows is ${w.maxDiscountPercent}% off (${usd(w.minBilled)}).`
  const more = rest.length ? ` ${rest.length} more partner unit${rest.length === 1 ? '' : 's'} on this order would too.` : ''
  return (
    `That takes SirReel below its ${floorPercent}% minimum on ${m.unitName}: the client would pay ${usd(w.billed)} of the ${usd(w.list)} list ` +
    `(${w.discountPercent}% off), ${owed}, and SirReel would keep ${usd(m.sirreelKeep ?? 0)}.${deepest}${more}`
  )
}
