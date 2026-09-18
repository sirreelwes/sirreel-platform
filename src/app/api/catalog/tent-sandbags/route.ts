import { NextRequest, NextResponse } from 'next/server'
import { TENT_CATEGORY_SLUG } from '@/lib/sales/tentFirst'
import { isSandbagItem } from '@/lib/sales/tentSandbags'
import { clientPrice } from '@/lib/pricing/companyRate'
import { itemStandingDiscounts } from '@/lib/pricing/resolveRate'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * WHICH sandbag the order form offers with a tent.
 *
 * Wes 2026-09-13: "Whenever we rent tents, we want to offer sandbags."
 * HOW MANY is a pure rule (src/lib/sales/tentSandbags.ts, four per 10x10
 * and so on); WHICH ROW is a catalog question, and this is it.
 *
 * Resolved, never hardcoded. The catalog carries the bags under several
 * spellings and in two places — "Sand Bags, 25lbs" / "Sand Bags, 35lbs"
 * in Tents & Accessories, "25 LB. SANDBAG" in the older grip rows — and a
 * pinned code would break the offer the first time one is re-coded. The
 * tent category is preferred so the offer stays inside the family the
 * tents live in; anything active falls back behind it.
 *
 * CHEAPEST FIRST: the 25 lb bag is the everyday tent ballast and the 35
 * is the exception, so the light one is what gets offered. The added line
 * is an ordinary catalog row — a rep who wants the heavy bag retypes the
 * line like any other.
 *
 * `companyId=` applies that client's negotiated rate, exactly as
 * /api/catalog/search does: an offer that pre-fills list price on a
 * client who has a deal quietly overcharges them.
 */
export async function GET(req: NextRequest) {
  const companyId = (new URL(req.url).searchParams.get('companyId') || '').trim() || null

  // A small set either way (the catalog holds four sandbag rows), so this
  // reads them all and picks in JS rather than trying to express
  // "is a sandbag" as a query.
  const rows = await prisma.inventoryItem.findMany({
    where: {
      isActive: true,
      trackingMode: 'QUANTITY',
      OR: [
        { description: { contains: 'sand', mode: 'insensitive' } },
        { code: { contains: 'SAND', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true, code: true, description: true, department: true,
      dailyRate: true, weeklyRate: true,
      category: { select: { slug: true } },
    },
  })

  const sandbags = rows.filter((r) => isSandbagItem(r.description || r.code))
  if (sandbags.length === 0) return NextResponse.json({ item: null })

  const inTentCategory = sandbags.filter((r) => r.category?.slug === TENT_CATEGORY_SLUG)
  const pool = inTentCategory.length > 0 ? inTentCategory : sandbags
  // Cheapest bag wins; a stable name tiebreak so the offer doesn't move
  // around between requests when two rows share a rate.
  const pick = [...pool].sort((a, b) => {
    const d = Number(a.dailyRate) - Number(b.dailyRate)
    if (d !== 0) return d
    return (a.description || a.code).localeCompare(b.description || b.code)
  })[0]

  // Both kinds of deal, same rule as the typeahead: the rate card prices
  // it if there is one, otherwise an item-scoped standing discount does.
  let deal = null
  if (companyId) {
    const [rate, standingByItem] = await Promise.all([
      prisma.companyRate.findFirst({
        where: { companyId, inventoryItemId: pick.id },
        select: { dailyRate: true, weeklyRate: true },
      }),
      itemStandingDiscounts(companyId, [pick.id]),
    ])
    const priced = clientPrice(
      { dailyRate: pick.dailyRate, weeklyRate: pick.weeklyRate },
      rate,
      standingByItem.get(pick.id) ?? null,
    )
    if (priced.negotiated) deal = priced
  }

  const listDaily = Number(pick.dailyRate)
  const listWeekly = Number(pick.weeklyRate)
  return NextResponse.json({
    item: {
      id: pick.id,
      name: pick.description || pick.code,
      department: pick.department,
      dailyRate: deal?.dailyRate != null ? Number(deal.dailyRate) : listDaily,
      weeklyRate: deal?.weeklyRate != null ? Number(deal.weeklyRate) : listWeekly,
      listDailyRate: listDaily,
      listWeeklyRate: listWeekly,
      negotiated: !!deal,
      dealLabel: deal?.dealLabel ?? null,
    },
  })
}
