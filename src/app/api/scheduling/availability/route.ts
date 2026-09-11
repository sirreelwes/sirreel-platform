/**
 * Native availability — single-category. Thin HTTP wrapper around
 * `getCategoryAvailability` from `src/lib/scheduling/availability.ts`.
 *
 * Query params:
 *   categoryId  — UUID of AssetCategory  (required)
 *   start       — YYYY-MM-DD              (required, inclusive)
 *   end         — YYYY-MM-DD              (required, inclusive)
 *   bufferDays  — integer                 (optional, default 1)
 *
 * Shadow-mode read-only — does NOT create holds or assignments. The
 * frontend uses this to ask "what would native say right now?"
 * alongside Planyo's answer.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCategoryAvailability } from '@/lib/scheduling/availability'
import { requireReadSession } from '@/lib/scheduling/requireReadSession'

export const dynamic = 'force-dynamic'

function parseISODate(s: string | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function GET(req: Request) {
  const denied = await requireReadSession()
  if (denied) return denied

  const url = new URL(req.url)
  let categoryId = url.searchParams.get('categoryId')
  const start = parseISODate(url.searchParams.get('start'))
  const end = parseISODate(url.searchParams.get('end'))
  const bufferDays = parseInt(url.searchParams.get('bufferDays') ?? '1', 10)

  // A catalog pick is an INVENTORY row, not a category — the order form's
  // catalog box and the quote builder both hold one of those and nothing
  // else. Resolve it here the way holdOnQuoteSend does (unit-tracked +
  // legacyAssetCategoryId) so those surfaces can ask "is a van free?"
  // without learning the category first. A quantity-tracked item answers
  // `holdable: false` rather than 400 — the caller hides the unit block.
  const inventoryItemId = url.searchParams.get('inventoryItemId')
  if (!categoryId && inventoryItemId) {
    const inv = await prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
      select: { trackingMode: true, legacyAssetCategoryId: true, department: true },
    })
    if (!inv) return NextResponse.json({ error: 'inventory item not found' }, { status: 404 })
    const holdable =
      inv.trackingMode === 'UNIT_TRACKED' &&
      (inv.department === 'VEHICLES' || inv.department === 'STAGES') &&
      !!inv.legacyAssetCategoryId
    if (!holdable) return NextResponse.json({ ok: true, holdable: false, categoryId: null, units: [] })
    categoryId = inv.legacyAssetCategoryId
  }

  if (!categoryId) return NextResponse.json({ error: 'categoryId or inventoryItemId required' }, { status: 400 })
  if (!start || !end) return NextResponse.json({ error: 'start and end (YYYY-MM-DD) required' }, { status: 400 })
  if (end < start) return NextResponse.json({ error: 'end must be >= start' }, { status: 400 })

  const result = await getCategoryAvailability(categoryId, start, end, Number.isFinite(bufferDays) ? bufferDays : 1)
  return NextResponse.json({ ok: true, holdable: true, categoryId, ...result })
}
