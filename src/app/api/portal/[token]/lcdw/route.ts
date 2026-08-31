/**
 * GET /api/portal/[token]/lcdw — which of THIS client's vehicles the
 * damage waiver would actually cover.
 *
 * Wes, 2026-08-29: the waiver "needs to be a clear option toggle choice
 * in the Rental Agreement too."
 *
 * The portal card was already a toggle. What it could not say was WHICH
 * vehicles it applied to — it printed the addendum's generic eligibility
 * paragraph and left the client to work out whether their own order was
 * covered. So a client with a PopVan could accept the waiver, pay for it,
 * and learn at claim time that their vehicle was never eligible. This
 * route answers the question against their actual booking.
 *
 * ── Resolving a booking item to a catalog code ─────────────────────
 *
 * Only 53% of BookingItems carry catalogItemId (the Aug-2026 unified
 * catalog is mid-cutover). The rest resolve through
 * InventoryItem.legacyAssetCategoryId, which covers all 14 asset
 * categories — measured 2026-08-31: 346/346 booking items resolve.
 *
 * Resolved by FK, never by transforming the slug: `lankershim-studios`
 * maps to CAT_STUDIOS, not CAT_LANKERSHIM_STUDIOS. A string rule would
 * have looked right on 13 of 14 categories.
 *
 * Unauthenticated by design — the token IS the credential, same as every
 * other /api/portal/[token] route. Returns descriptions only: no rates,
 * no ids the client has no use for.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { quoteLcdw, type LcdwCandidate } from '@/lib/pricing/lcdwEligibility'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const request = await prisma.paperworkRequest.findUnique({
    where: { token: params.token },
    select: {
      booking: {
        select: {
          items: {
            select: {
              id: true,
              quantity: true,
              categoryId: true,
              category: { select: { name: true } },
              catalogItem: { select: { code: true, description: true, department: true } },
            },
          },
        },
      },
    },
  })
  if (!request?.booking) {
    return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })
  }

  const items = request.booking.items

  // One lookup for every item that needs the legacy bridge.
  const needBridge = [...new Set(items.filter((i) => !i.catalogItem).map((i) => i.categoryId))]
  const bridged = needBridge.length
    ? await prisma.inventoryItem.findMany({
        where: { legacyAssetCategoryId: { in: needBridge } },
        select: { code: true, department: true, legacyAssetCategoryId: true },
      })
    : []
  const byCategory = new Map(bridged.map((b) => [b.legacyAssetCategoryId!, b]))

  const candidates: LcdwCandidate[] = items.map((i) => {
    const resolved = i.catalogItem ?? byCategory.get(i.categoryId) ?? null
    return {
      id: i.id,
      description: i.catalogItem?.description || i.category?.name || 'Item',
      code: resolved?.code ?? null,
      // No catalog match at all → not judged as a vehicle. Silence is the
      // safe direction: it leaves the item off the covered list rather
      // than promising coverage we haven't established.
      department: resolved?.department ?? 'UNKNOWN',
      quantity: i.quantity,
      // Booking items carry no billable days and this route prices
      // nothing — the card states the $/day rate itself.
      billableDays: 0,
    }
  })

  const quote = quoteLcdw(candidates)
  return NextResponse.json({
    covered: quote.eligible.map((v) => v.description),
    excluded: quote.excluded.map((v) => ({ description: v.description, reason: v.reason })),
    allExcluded: quote.allExcluded,
    hasVehicles: quote.eligible.length + quote.excluded.length > 0,
  })
}
