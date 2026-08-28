/**
 * Company spend rollup — the number the whole CRM scoring layer was
 * waiting on.
 *
 * ── What was broken ────────────────────────────────────────────────
 * Measured 2026-08-28: `Company.totalSpend` was 0 across all 4,207
 * companies and `totalBookings` 0 across all of them. Nothing had ever
 * written those columns (the only writer was an increment inside the
 * duplicate-merge path). Everything downstream was therefore dead and
 * silently so — the TOP_CLIENT / REPEAT / LOYAL / QUIET badges, the
 * Companies tab's Top-clients chip, the spend sort, and three of the
 * People segments. They all read zeros and rendered as "nobody
 * qualifies".
 *
 * ── Where the money actually is ────────────────────────────────────
 * Not in HQ. HQ holds 22 Orders totalling $36K; billing still lives in
 * RentalWorks. The real book is the RW invoice mirror: 4,450 rows,
 * $6.07M invoiced, 928 distinct customers, July 2025 → today. It joins
 * to HQ on `RwInvoice.rwCustomerId → Company.rentalworksCustomerId`,
 * which resolves 793 of the 928 customers and covers $5.58M — 91.9% of
 * revenue. The unmatched 8.1% is reported by the script, never guessed.
 *
 * ── Two properties this has to have ────────────────────────────────
 *
 * 1. RECOMPUTE, never accumulate. `RwInvoice` is a mirror that is
 *    DELETED AND RECREATED on every RW sync. Incrementing totals would
 *    double-count on the next sync and drift forever. Every run derives
 *    the number from scratch and overwrites.
 *
 * 2. Say what window it covers. The mirror starts 2025-07-18, so
 *    "total spend" here means *since July 2025*, not lifetime. The
 *    stamp on `spendRolledUpAt` lets the UI say "as of" rather than
 *    implying a live figure.
 *
 * `totalBookings` counts DISTINCT RW ORDERS, not invoices. One rental
 * is routinely invoiced several times (deposit, balance, extension) and
 * counting invoices would inflate every repeat-customer signal by a
 * factor nobody could explain.
 */

import { prisma } from '@/lib/prisma'

export interface CompanyRollupRow {
  companyId: string
  rwCustomerId: string
  totalSpend: number
  /** Distinct RW orders — the count of actual rentals. */
  totalBookings: number
  lastRentalAt: Date | null
}

export interface RollupPlan {
  rows: CompanyRollupRow[]
  /** Revenue whose RW customer has no HQ company — reported, not guessed. */
  unmatchedRevenue: number
  unmatchedCustomers: { rwCustomerId: string; customerName: string | null; total: number }[]
  /** Companies currently carrying a non-zero total that this run would zero. */
  zeroedCompanies: number
  totalMatchedRevenue: number
  invoiceCount: number
}

/**
 * Build the rollup WITHOUT writing anything.
 *
 * Kept separate from the write so the script can print a full plan, and
 * so the post-sync hook can log what it is about to do.
 */
export async function buildRollupPlan(): Promise<RollupPlan> {
  const [invoices, companies] = await Promise.all([
    prisma.rwInvoice.findMany({
      select: {
        rwCustomerId: true,
        customerName: true,
        rwOrderId: true,
        invoiceTotal: true,
        billingEndDate: true,
        invoiceDate: true,
      },
    }),
    prisma.company.findMany({
      where: { rentalworksCustomerId: { not: null } },
      select: { id: true, rentalworksCustomerId: true, totalSpend: true },
    }),
  ])

  const companyByRwId = new Map<string, { id: string; priorSpend: number }>()
  for (const c of companies) {
    if (c.rentalworksCustomerId) {
      companyByRwId.set(c.rentalworksCustomerId, {
        id: c.id,
        priorSpend: Number(c.totalSpend),
      })
    }
  }

  interface Acc {
    total: number
    orders: Set<string>
    invoicesWithoutOrder: number
    last: Date | null
    name: string | null
  }
  const byCustomer = new Map<string, Acc>()

  for (const inv of invoices) {
    const key = inv.rwCustomerId
    if (!key) continue
    let acc = byCustomer.get(key)
    if (!acc) {
      acc = { total: 0, orders: new Set(), invoicesWithoutOrder: 0, last: null, name: inv.customerName }
      byCustomer.set(key, acc)
    }
    acc.total += Number(inv.invoiceTotal)
    // Distinct RENTALS. An invoice with no order id cannot be deduped,
    // so it counts as its own rental rather than being dropped.
    if (inv.rwOrderId) acc.orders.add(inv.rwOrderId)
    else acc.invoicesWithoutOrder += 1
    // billingEndDate is when the gear actually came back; invoiceDate is
    // the fallback for rows that never carried a rental window.
    const when = inv.billingEndDate ?? inv.invoiceDate
    if (when && (!acc.last || when > acc.last)) acc.last = when
  }

  const rows: CompanyRollupRow[] = []
  const unmatchedCustomers: RollupPlan['unmatchedCustomers'] = []
  let unmatchedRevenue = 0
  let totalMatchedRevenue = 0

  for (const [rwCustomerId, acc] of byCustomer) {
    const company = companyByRwId.get(rwCustomerId)
    if (!company) {
      unmatchedRevenue += acc.total
      unmatchedCustomers.push({ rwCustomerId, customerName: acc.name, total: acc.total })
      continue
    }
    totalMatchedRevenue += acc.total
    rows.push({
      companyId: company.id,
      rwCustomerId,
      totalSpend: Math.round(acc.total * 100) / 100,
      totalBookings: acc.orders.size + acc.invoicesWithoutOrder,
      lastRentalAt: acc.last,
    })
  }

  // A company that previously had a total and is no longer in the mirror
  // gets zeroed — that is correct (the invoice is gone) but worth
  // counting out loud, because a large number here means the RW sync
  // returned a partial pull and we are about to erase real history.
  const rolledIds = new Set(rows.map((r) => r.companyId))
  const zeroedCompanies = companies.filter(
    (c) => Number(c.totalSpend) > 0 && !rolledIds.has(c.id),
  ).length

  unmatchedCustomers.sort((a, b) => b.total - a.total)
  rows.sort((a, b) => b.totalSpend - a.totalSpend)

  return {
    rows,
    unmatchedRevenue,
    unmatchedCustomers,
    zeroedCompanies,
    totalMatchedRevenue,
    invoiceCount: invoices.length,
  }
}

export interface RollupResult {
  updated: number
  zeroed: number
  rolledUpAt: Date
}

/**
 * Apply a plan.
 *
 * Companies that matched get their real numbers; companies that carry a
 * stale non-zero total but no longer appear in the mirror are reset, so
 * the columns never hold a figure no invoice supports.
 *
 * `safetyFloor` refuses to run when the mirror looks unexpectedly empty
 * — an RW token expiry or a half-finished sync would otherwise zero the
 * entire client book in one statement. Pass 0 only to deliberately
 * apply an empty mirror.
 */
export async function applyRollup(
  plan: RollupPlan,
  opts: { safetyFloor?: number } = {},
): Promise<RollupResult> {
  const floor = opts.safetyFloor ?? 100
  if (plan.invoiceCount < floor) {
    throw new Error(
      `Refusing to roll up: the RW mirror holds only ${plan.invoiceCount} invoices (floor ${floor}). ` +
        'That usually means a failed or partial sync, and applying it would erase real spend history.',
    )
  }

  const rolledUpAt = new Date()

  // One statement per company. 793 updates is a couple of seconds and
  // keeps the code obvious; a CASE-based bulk update would be faster and
  // far harder to reason about when a number looks wrong.
  for (const row of plan.rows) {
    await prisma.company.update({
      where: { id: row.companyId },
      data: {
        totalSpend: row.totalSpend,
        totalBookings: row.totalBookings,
        lastRentalAt: row.lastRentalAt,
        spendRolledUpAt: rolledUpAt,
      },
    })
  }

  const rolledIds = plan.rows.map((r) => r.companyId)
  const zeroed = await prisma.company.updateMany({
    where: {
      id: { notIn: rolledIds.length > 0 ? rolledIds : ['__none__'] },
      OR: [{ totalSpend: { gt: 0 } }, { totalBookings: { gt: 0 } }],
    },
    data: { totalSpend: 0, totalBookings: 0, lastRentalAt: null, spendRolledUpAt: rolledUpAt },
  })

  return { updated: plan.rows.length, zeroed: zeroed.count, rolledUpAt }
}

/** Build and apply in one call — what the post-sync hook uses. */
export async function runSpendRollup(opts: { safetyFloor?: number } = {}): Promise<RollupResult> {
  const plan = await buildRollupPlan()
  return applyRollup(plan, opts)
}
