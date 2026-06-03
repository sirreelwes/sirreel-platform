/**
 * GET /api/crm/stats — full-population CRM aggregates.
 *
 * The CRM lists are page-capped (`take: 100`), so deriving the
 * Top-client decile threshold, strip counts, and segment counts
 * from the rendered page would drift with the page + any active
 * filter. This endpoint runs four single-shot DB aggregates so
 * the badge meaning + Needs-attention counts are stable across
 * every page and filter:
 *
 *   topClientSpendCutoff  — 90th-percentile totalSpend across
 *                           Companies WHERE totalSpend > 0 (single
 *                           ordered query, no N+1)
 *   topClientsCount       — companies WHERE totalSpend >= cutoff
 *                           (used by the Top-clients segment chip)
 *   goneQuietCount        — companies WHERE lastOrderAt is set AND
 *                           is older than QUIET_DAYS
 *   discountWatchCount    — companies WHERE discountTendency IN
 *                           (FREQUENT, ALWAYS)
 *   neverOrderedCount     — companies WHERE _count.orders = 0
 *                           (used by the Never-ordered segment chip)
 *   followUpDueCount      — Activity rows with dueDate <= now,
 *                           completed=false, not soft-deleted
 *
 * Auth: getServerSession. Read-only.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { QUIET_DAYS, fetchPopulationTopClientCutoff } from '@/lib/crm/clientBadges'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const quietCutoff = new Date(now)
  quietCutoff.setDate(quietCutoff.getDate() - QUIET_DAYS)

  // 1) Top-client decile cutoff — shared helper, single ordered
  // query over Companies WHERE totalSpend > 0. Also used by the
  // list routes so badges agree across pages. Count tags along so
  // the Top-clients segment chip can show "Top clients · 12" with
  // the exact population count (including ties at the cutoff).
  const topClientSpendCutoff = await fetchPopulationTopClientCutoff()
  const topClientsCount = topClientSpendCutoff > 0
    ? await prisma.company.count({ where: { totalSpend: { gte: topClientSpendCutoff } } })
    : 0

  // 2) Gone-quiet count. Single Order groupBy + an in-memory pass
  // (no per-company query). For each company that has orders we
  // ask: is their MAX(createdAt) before quietCutoff? Count of yes.
  const orderRollup = await prisma.order.groupBy({
    by: ['companyId'],
    _max: { createdAt: true },
  })
  const goneQuietCount = orderRollup.filter(
    (r) => r._max.createdAt && r._max.createdAt <= quietCutoff,
  ).length

  // 3) Discount-watch count.
  const discountWatchCount = await prisma.company.count({
    where: { discountTendency: { in: ['FREQUENT', 'ALWAYS'] } },
  })

  // 4) Never-ordered count. Companies with no Order rows. Inverse
  // of the orderRollup's distinct companyIds against the total
  // company count.
  const totalCompanies = await prisma.company.count()
  const companiesWithOrders = orderRollup.length
  const neverOrderedCount = Math.max(0, totalCompanies - companiesWithOrders)

  // 5) Follow-up-due count — Activity rows that are pending today.
  const followUpDueCount = await prisma.activity.count({
    where: { completed: false, dueDate: { lte: now, not: null } },
  })

  return NextResponse.json({
    topClientSpendCutoff,
    topClientsCount,
    goneQuietCount,
    discountWatchCount,
    neverOrderedCount,
    followUpDueCount,
    totalCompanies,
  })
}
