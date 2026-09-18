/**
 * Is this order actually honouring the client's standing deals?
 *
 * Wes 2026-09-17: "confirming that production companies with discounts
 * provided will automatically receive them on orders."
 *
 * The CompanyDiscount schema comment has claimed since 2026-09-04 that
 * "the staff-side order page surfaces these as a reminder" — it never
 * did. A rep on an order had no way to see that the account had a deal
 * at all, which matters because the two kinds of deal reach an order by
 * two different mechanisms and BOTH can miss:
 *
 *   DEPARTMENT-scoped — seeded as an OrderDiscount row at order CREATE
 *     (applyStandingDiscounts). An order created before the deal was
 *     entered never got one, and neither did one whose production
 *     company was corrected afterwards.
 *
 *   ITEM-scoped — priced into the LINE by resolveRate, so there is no
 *     discount row to look for. Until 2026-09-18 the rep's typeahead
 *     pre-filled LIST for these, so lines added by hand bill above the
 *     deal while the order looks perfectly normal.
 *
 * So this is a RECONCILIATION, not a list. A list would leave the rep
 * doing the comparison by eye against a panel of numbers, which is the
 * work the reminder exists to save.
 *
 * Pure — no prisma, no dates resolved here. The caller passes only deals
 * it has already filtered to active and in-window, because "is this deal
 * live today" is a database question and having two answers to it is how
 * a reminder starts lying. `npm run test:standing-deal-check`.
 */

/** Half a cent — money arrives here as Number at the display boundary. */
const CENT = 0.005

/**
 * Expendables are a SALE, not a rental — passed through at cost, no
 * day-rate margin to give back (Wes 2026-08-29). computeOrderTotals skips
 * the department outright and the discounts route refuses one out loud.
 *
 * The CRM's department list still offers it, though, so "20% off
 * Expendables" can be sitting on an account — and applyStandingDiscounts
 * has no such filter, so it may even have seeded a row. Reporting that as
 * 'applied' would be the panel telling a rep a discount is live when the
 * totals zero it. It gets its own verdict instead, whatever else is true.
 */
const NEVER_DISCOUNTED = 'EXPENDABLES'

export interface StandingDealInput {
  id: string
  label: string
  percentOff: number
  /** Set = the deal IS a whole department. Null = it covers items. */
  departmentKey: string | null
  inventoryItemIds: string[]
}

export interface OrderDiscountInput {
  scope: string
  departmentKey: string | null
  type: string
  value: number
  label: string
}

export interface OrderLineInput {
  id: string
  description: string
  inventoryItemId: string | null
  department: string
  /** What the line bills at. */
  rate: number
  /**
   * What the server resolved this client's price to be (resolveRate,
   * which already applies the rate card and the item-scoped deal). Null
   * on a line that was never resolved — an unpriced catalog row, or a
   * line written before the snapshot existed.
   */
  resolvedRate: number | null
}

export type StandingDealVerdict =
  /** Department deal: on the order at the agreed percent. */
  | 'applied'
  /** Department deal: a discount row is there, at a different figure. */
  | 'differs'
  /** Department deal: the order quotes that department and carries no row. */
  | 'missing'
  /** Nothing on this order for the deal to cover — nothing owed yet. */
  | 'not-quoted'
  /** Item deal: every covered line bills at their price. */
  | 'priced-in'
  /** Item deal: a covered line bills ABOVE their price. */
  | 'over-billed'
  /** Item deal: covered lines carry no resolved rate to check against. */
  | 'unchecked'
  /** The department carries no discount at all, so the deal cannot land. */
  | 'not-applicable'

export interface StandingDealLineFlag {
  lineId: string
  description: string
  /** What it bills at now. */
  rate: number
  /** What this client's deal makes it. */
  dealRate: number
}

export interface StandingDealReport {
  dealId: string
  label: string
  percentOff: number
  scope: 'DEPARTMENT' | 'ITEMS'
  departmentKey: string | null
  verdict: StandingDealVerdict
  /** One plain sentence for the panel — what is there instead, if anything. */
  detail: string | null
  /** Lines billing above the deal. Only ever set on 'over-billed'. */
  lines: StandingDealLineFlag[]
  /**
   * The deal can be put on this order in one press — it is a department
   * deal, the order quotes that department, and nothing is in the way.
   * An item deal never sets it: there is no row to create, the price is
   * the line's, and a button that silently retyped rates would be doing
   * a rep's pricing for them.
   */
  canApply: boolean
}

/** True when the reminder has something a person should act on. */
export function needsAttention(r: StandingDealReport): boolean {
  return r.verdict === 'missing' || r.verdict === 'over-billed' || r.verdict === 'differs'
}

function describeDiscountRow(d: OrderDiscountInput): string {
  if (d.type === 'PERCENT') return `${d.value}% off`
  return `$${d.value.toFixed(2)} off`
}

/**
 * One report per deal, in the order the deals were passed.
 *
 * A deal is DEPARTMENT-scoped or ITEM-scoped, never both — the CRM route
 * refuses a row carrying both, precisely because it would discount the
 * same line twice. `departmentKey` is the discriminator here for the same
 * reason applyStandingDiscounts and findItemStandingDiscount use it.
 */
export function reconcileStandingDeals(input: {
  deals: StandingDealInput[]
  discounts: OrderDiscountInput[]
  lines: OrderLineInput[]
}): StandingDealReport[] {
  const { deals, discounts, lines } = input

  return deals.map((deal): StandingDealReport => {
    const base = {
      dealId: deal.id,
      label: deal.label,
      percentOff: deal.percentOff,
      departmentKey: deal.departmentKey,
      lines: [] as StandingDealLineFlag[],
      canApply: false,
    }

    if (deal.departmentKey === NEVER_DISCOUNTED) {
      return {
        ...base,
        scope: 'DEPARTMENT',
        verdict: 'not-applicable',
        detail: 'expendables are a sale, not a rental — they carry no discount',
      }
    }

    if (deal.departmentKey) {
      const row = discounts.find(
        (d) => d.scope === 'DEPARTMENT' && d.departmentKey === deal.departmentKey,
      )
      if (row) {
        const matches = row.type === 'PERCENT' && Math.abs(row.value - deal.percentOff) < CENT
        return {
          ...base,
          scope: 'DEPARTMENT',
          verdict: matches ? 'applied' : 'differs',
          detail: matches ? null : `on this order as ${describeDiscountRow(row)}`,
        }
      }
      // No row. Whether that is a problem depends on whether the order
      // quotes anything in that department at all — a supplies deal on a
      // vehicles-only order is not a miss, and nagging about it would
      // teach the rep to stop reading the panel.
      const quoted = lines.some((l) => l.department === deal.departmentKey)
      return {
        ...base,
        scope: 'DEPARTMENT',
        verdict: quoted ? 'missing' : 'not-quoted',
        detail: quoted ? 'no discount row on this order' : null,
        canApply: quoted,
      }
    }

    // ── Item-scoped: there is no row to find. The deal lives in the
    // line's rate, so the check is against what each covered line bills.
    const covered = new Set(deal.inventoryItemIds)
    const onOrder = lines.filter((l) => l.inventoryItemId && covered.has(l.inventoryItemId))
    if (onOrder.length === 0) {
      return { ...base, scope: 'ITEMS', verdict: 'not-quoted', detail: null }
    }

    const checkable = onOrder.filter((l) => l.resolvedRate != null)
    if (checkable.length === 0) {
      return {
        ...base,
        scope: 'ITEMS',
        verdict: 'unchecked',
        detail: `${onOrder.length} line${onOrder.length === 1 ? '' : 's'} on this order, no resolved rate to check against`,
      }
    }

    const over = checkable
      .filter((l) => l.rate - (l.resolvedRate as number) > CENT)
      .map((l) => ({
        lineId: l.id,
        description: l.description,
        rate: l.rate,
        dealRate: l.resolvedRate as number,
      }))

    if (over.length === 0) {
      return { ...base, scope: 'ITEMS', verdict: 'priced-in', detail: null }
    }
    return {
      ...base,
      scope: 'ITEMS',
      verdict: 'over-billed',
      detail: `${over.length} line${over.length === 1 ? '' : 's'} billing above their price`,
      lines: over,
    }
  })
}
