/**
 * The publish desk's API — /admin/public-catalog.
 *
 * GET   the whole publishable catalog, each row carrying its gate state.
 * PATCH publish or hide a batch of items.
 *
 * Why the whole catalog in one GET: ~1,750 trimmed rows is a couple of
 * hundred KB, and it buys instant client-side filtering across search,
 * category and stock — which is the entire job of this screen. A
 * per-keystroke round trip would make the desk slower than the spreadsheet
 * it replaces.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-admin'
import {
  PUBLISHABLE_CANDIDATE_WHERE,
  hasPublicPrice,
  publicBlockReason,
  publishingIsEnough,
} from '@/lib/catalog/publicVisibility'

export const dynamic = 'force-dynamic'

const SELECT = {
  id: true,
  code: true,
  description: true,
  aliases: true,
  dailyRate: true,
  includedFree: true,
  qtyOwned: true,
  publicVisible: true,
  isActive: true,
  categoryId: true,
  trackingMode: true,
  category: { select: { id: true, name: true } },
} as const

export async function GET() {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  // Everything active, whether or not it has a category — the two
  // uncategorised buckets are part of what this screen has to explain.
  const rows = await prisma.inventoryItem.findMany({
    where: { isActive: true },
    select: SELECT,
    orderBy: [{ description: 'asc' }],
  })

  const items = rows.map((r) => ({
    id: r.id,
    name: r.description ?? r.code,
    code: r.code,
    category: r.category?.name ?? null,
    daily: Number(r.dailyRate),
    includedFree: r.includedFree,
    qty: r.qtyOwned,
    aliases: r.aliases,
    published: r.publicVisible,
    // A vehicle or stage row: it already has its own public page, so
    // publishing it here would list the same truck twice.
    unitTracked: r.trackingMode === 'UNIT_TRACKED',
    blockedBy: publicBlockReason(r),
    // false = flipping the switch alone changes nothing a client can see.
    readyToPublish: publishingIsEnough(r),
  }))

  const counts = {
    active: items.length,
    categorised: items.filter((i) => i.category !== null).length,
    priced: items.filter((i) => i.category !== null && hasPublicPrice({ dailyRate: i.daily, includedFree: i.includedFree })).length,
    published: items.filter((i) => i.published && i.blockedBy === null).length,
    hidden: items.filter((i) => i.blockedBy === 'not-public').length,
    hiddenInStock: items.filter((i) => i.blockedBy === 'not-public' && i.qty > 0).length,
    noPrice: items.filter((i) => i.blockedBy === 'no-price').length,
    noCategory: items.filter((i) => i.blockedBy === 'no-category').length,
  }

  return NextResponse.json({ items, counts })
}

interface PatchBody {
  ids?: unknown
  publicVisible?: unknown
  /** Publishing a vehicle/stage row needs an explicit opt-in. */
  allowUnitTracked?: unknown
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate
  const { user } = gate

  const body = (await req.json().catch(() => ({}))) as PatchBody
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : []
  const publish = body.publicVisible === true
  const allowUnitTracked = body.allowUnitTracked === true

  if (ids.length === 0) return NextResponse.json({ error: 'no items selected' }, { status: 400 })
  if (typeof body.publicVisible !== 'boolean') {
    return NextResponse.json({ error: 'publicVisible must be true or false' }, { status: 400 })
  }

  // Re-read the rows rather than trusting what the browser believes about
  // them: the gate is decided here, on current data.
  const rows = await prisma.inventoryItem.findMany({
    where: { id: { in: ids } },
    select: SELECT,
  })
  const found = new Set(rows.map((r) => r.id))
  const missing = ids.filter((id) => !found.has(id))

  const skipped: { id: string; name: string; why: string }[] = []
  const allowed: string[] = []

  for (const r of rows) {
    const name = r.description ?? r.code
    if (publish) {
      // Hiding is always safe. Publishing is what has preconditions.
      if (!r.isActive) { skipped.push({ id: r.id, name, why: 'archived' }); continue }
      if (!r.categoryId) { skipped.push({ id: r.id, name, why: 'no category' }); continue }
      if (!hasPublicPrice(r)) { skipped.push({ id: r.id, name, why: 'no price' }); continue }
      if (r.trackingMode === 'UNIT_TRACKED' && !allowUnitTracked) {
        skipped.push({ id: r.id, name, why: 'already public on its own page' })
        continue
      }
    }
    if (r.publicVisible === publish) continue // already there; not a change
    allowed.push(r.id)
  }

  if (allowed.length > 0) {
    await prisma.inventoryItem.updateMany({
      where: { id: { in: allowed } },
      data: { publicVisible: publish },
    })
    // One audit row per batch, carrying the captured ids — so a change can
    // be traced back and, if it was wrong, reversed by exactly those ids.
    await prisma.auditLog.create({
      data: {
        action: publish ? 'catalog.publish' : 'catalog.hide',
        entityType: 'InventoryItem',
        entityId: allowed.length === 1 ? allowed[0] : `batch:${allowed.length}`,
        userId: user.id,
        oldValues: { publicVisible: !publish, ids: allowed },
        newValues: { publicVisible: publish, ids: allowed },
      },
    })
  }

  return NextResponse.json({
    ok: true,
    changed: allowed.length,
    skipped,
    missing,
  })
}
