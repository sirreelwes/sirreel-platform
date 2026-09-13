/**
 * GET /api/warehouse/catalog?q= — the catalog as the DOCK sees it.
 *
 * The check-out report lets the warehouse swap a piece or add a row at
 * pickup (Wes 2026-09-12), and a swap-in or an addition picked from the
 * catalog is what lets the rate follow the line. The sales combobox's
 * search (/api/catalog/search) is the wrong door for that: it returns
 * daily and weekly rates, list and negotiated, and the WAREHOUSE role
 * has seePricing:false — a yard screen must not fetch numbers it may
 * not show. This route returns names and codes only, behind the yard
 * door, and only WAREHOUSE GEAR (trackingMode QUANTITY): a vehicle or a
 * stage swap is dispatch's, through the assignment flow, never a
 * pull-sheet edit.
 *
 * Matching is the sales search's: every token must hit code,
 * description, slug or an alias; multi-word aliases resolve in JS
 * (aliasesAnswerQuery) — the same reason and the same rule.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireYardAccess } from '@/lib/yard/requireYardAccess'
import { aliasesAnswerQuery } from '@/lib/sales/aliasMatch'
import { mergeMeasureTokens, tokenVariants } from '@/lib/sales/catalogMatcher'

export const dynamic = 'force-dynamic'

export interface DockCatalogHit {
  id: string
  code: string
  description: string
  department: string
}

export async function GET(req: NextRequest) {
  const auth = await requireYardAccess()
  if (!auth.ok) return auth.response

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (!q) return NextResponse.json({ results: [] as DockCatalogHit[] })
  const limit = Math.min(12, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '8', 10) || 8))

  const tokens = mergeMeasureTokens(q.split(/\s+/).filter(Boolean))
  const variants = tokens.map(tokenVariants)

  const aliasRows = await prisma.inventoryItem.findMany({
    where: { isActive: true, trackingMode: 'QUANTITY', NOT: { aliases: { isEmpty: true } } },
    select: { id: true, aliases: true },
  })
  const aliasMatchIds = aliasRows.filter((r) => aliasesAnswerQuery(r.aliases, variants)).map((r) => r.id)

  const rows = await prisma.inventoryItem.findMany({
    where: {
      isActive: true,
      trackingMode: 'QUANTITY',
      OR: [
        ...(aliasMatchIds.length ? [{ id: { in: aliasMatchIds } }] : []),
        {
          AND: variants.map((vs) => ({
            OR: vs.flatMap((v) => [
              { code: { contains: v, mode: 'insensitive' as const } },
              { description: { contains: v, mode: 'insensitive' as const } },
              { slug: { contains: v, mode: 'insensitive' as const } },
              { aliases: { has: v } },
            ]),
          })),
        },
      ],
    },
    select: { id: true, code: true, description: true, department: true },
    take: limit,
    orderBy: [{ qtyOwned: 'desc' }, { description: 'asc' }],
  })

  const results: DockCatalogHit[] = rows.map((r) => ({
    id: r.id,
    code: r.code,
    description: r.description ?? r.code,
    department: r.department,
  }))
  return NextResponse.json({ results })
}
