/**
 * Client badge computation — derived on read, no schema columns.
 *
 * Two sides:
 *   VALUE badges  (company-level, mutually independent — a company
 *                  can wear several): TOP_CLIENT, REPEAT, LOYAL, NEW.
 *   FLAG badges   (state-of-the-moment, action-shaped):
 *                  NEGOTIATES (company), QUIET (company), FOLLOW_UP_DUE (person).
 *
 * People inherit their primary affiliation's company-side badges +
 * carry their own FOLLOW_UP_DUE.
 *
 * Thresholds are tunable constants. The TOP_CLIENT cutoff is normally
 * supplied by the caller as the *population* 90th-percentile spend
 * (computed once in /api/crm/stats so the badge means the same thing
 * on every page + filter). If no cutoff is passed, the helper falls
 * back to the local result-set cutoff — useful for one-off callers
 * that don't have a population aggregate handy.
 */
import type { DiscountTendency } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const REPEAT_MIN = 3
export const LOYAL_YEARS = 3
export const NEW_MONTHS = 6
export const TOP_CLIENT_DECILE = 0.1
export const QUIET_DAYS = 90

export type ClientBadge =
  | 'TOP_CLIENT'
  | 'REPEAT'
  | 'LOYAL'
  | 'NEW'
  | 'NEGOTIATES'
  | 'QUIET'
  | 'FOLLOW_UP_DUE'

export interface CompanyBadgeFacts {
  badges: ClientBadge[]
  /** First-order date — drives LOYAL + NEW. Null when the company
   *  has no orders yet. */
  firstOrderAt: string | null
  /** Last-order date — drives QUIET. Null when the company has no
   *  orders yet (in which case QUIET doesn't fire — see logic
   *  below: QUIET requires past orders). */
  lastOrderAt: string | null
  /** When LOYAL fires, the since-year for label rendering. */
  loyalSinceYear: number | null
}

interface CompanyInput {
  id: string
  totalSpend: number | string | { toString(): string }
  orderCount: number
  discountTendency: DiscountTendency
}

interface FirstLast {
  companyId: string
  firstOrderAt: Date | null
  lastOrderAt: Date | null
}

/**
 * Top-decile spend threshold. Pass the full result-set spend list.
 * Returns the threshold value at the 90th-percentile boundary; a
 * company qualifies as TOP_CLIENT if its spend is >= this value AND
 * the threshold is non-zero (we don't promote everyone when the
 * page is empty).
 */
export function topDecileThreshold(spends: number[]): number {
  if (spends.length === 0) return 0
  const sorted = [...spends].sort((a, b) => b - a)
  const idx = Math.max(0, Math.floor(sorted.length * TOP_CLIENT_DECILE) - 1)
  return sorted[idx] ?? 0
}

/**
 * Population top-client cutoff — single ordered query against every
 * Company with non-zero spend. Indexed by the default Company orderBy
 * (totalSpend desc), so this is one ordered scan. Shared by
 * /api/crm/stats and by the list routes so badges agree across the
 * whole CRM regardless of page or filter.
 */
export async function fetchPopulationTopClientCutoff(): Promise<number> {
  const spends = await prisma.company.findMany({
    where: { totalSpend: { gt: 0 } },
    select: { totalSpend: true },
    orderBy: { totalSpend: 'desc' },
  })
  if (spends.length === 0) return 0
  const idx = Math.max(0, Math.floor(spends.length * TOP_CLIENT_DECILE) - 1)
  return Number(spends[idx]?.totalSpend ?? 0)
}

/**
 * Compute the per-company badge facts. Single pass over the input;
 * the firstLast map is built upstream from a single Order groupBy.
 *
 * `topClientSpendCutoffOverride` — when provided, used in place of
 * the local decile (typical: the value from /api/crm/stats so every
 * page agrees on what "top client" means). Falls back to a local
 * decile over the input array when omitted.
 */
export function computeCompanyBadgeFacts(
  companies: CompanyInput[],
  firstLast: Map<string, FirstLast>,
  now: Date = new Date(),
  topClientSpendCutoffOverride?: number,
): Map<string, CompanyBadgeFacts> {
  const result = new Map<string, CompanyBadgeFacts>()
  const topCutoff =
    typeof topClientSpendCutoffOverride === 'number'
      ? topClientSpendCutoffOverride
      : topDecileThreshold(companies.map((c) => Number(c.totalSpend)))

  const loyalCutoff = new Date(now)
  loyalCutoff.setFullYear(loyalCutoff.getFullYear() - LOYAL_YEARS)
  const newCutoff = new Date(now)
  newCutoff.setMonth(newCutoff.getMonth() - NEW_MONTHS)
  const quietCutoff = new Date(now)
  quietCutoff.setDate(quietCutoff.getDate() - QUIET_DAYS)

  for (const c of companies) {
    const dates = firstLast.get(c.id) ?? { companyId: c.id, firstOrderAt: null, lastOrderAt: null }
    const spend = Number(c.totalSpend)
    const badges: ClientBadge[] = []

    // VALUE — TOP_CLIENT
    // Cutoff > 0 guard: a result set with all-zero spends shouldn't
    // promote everyone to top-client.
    if (topCutoff > 0 && spend >= topCutoff) badges.push('TOP_CLIENT')

    // VALUE — REPEAT
    if (c.orderCount >= REPEAT_MIN) badges.push('REPEAT')

    // VALUE — LOYAL: first-order >= 3 years ago. NEW + LOYAL are
    // mutually exclusive by construction (LOYAL requires first order
    // before loyalCutoff; NEW requires first order after newCutoff).
    if (dates.firstOrderAt && dates.firstOrderAt <= loyalCutoff) {
      badges.push('LOYAL')
    } else if (dates.firstOrderAt && dates.firstOrderAt >= newCutoff) {
      // VALUE — NEW (first order within last 6 months)
      badges.push('NEW')
    }

    // FLAG — NEGOTIATES
    if (c.discountTendency === 'FREQUENT' || c.discountTendency === 'ALWAYS') {
      badges.push('NEGOTIATES')
    }

    // FLAG — QUIET: has past orders AND last order before quietCutoff.
    // First-time companies (no orders) DO NOT get QUIET.
    if (dates.lastOrderAt && dates.lastOrderAt <= quietCutoff) {
      badges.push('QUIET')
    }

    result.set(c.id, {
      badges,
      firstOrderAt: dates.firstOrderAt?.toISOString() ?? null,
      lastOrderAt: dates.lastOrderAt?.toISOString() ?? null,
      loyalSinceYear: badges.includes('LOYAL') && dates.firstOrderAt
        ? dates.firstOrderAt.getFullYear()
        : null,
    })
  }

  return result
}
