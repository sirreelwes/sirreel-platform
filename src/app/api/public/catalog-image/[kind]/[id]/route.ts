/**
 * GET /api/public/catalog-image/[kind]/[id] — PUBLIC, SCOPED image proxy for
 * the unauthenticated order form (orders.sirreel.com).
 *
 * It streams ONLY two public-catalog image kinds, by id, from the PRIVATE blob
 * store via the shared streamPrivateBlobAsResponse helper — the raw private
 * blob URL is never exposed to the client, and a direct fetch of that blob
 * still 403s. This route is deliberately narrow:
 *
 *   kind=supply  → InventoryItem.imageUrl, served ONLY if the item is
 *                  publicVisible + isActive + categorized (the exact gate as
 *                  /api/public/catalog). A non-public item's image is denied.
 *   kind=vehicle → VehicleCategory's image, served ONLY if the row is active.
 *                  Source preference: VehicleCategory.photoUrl if set, else the
 *                  LINKED AssetCategory.imageUrl (assetCategoryId).
 *
 * Any other kind, a missing/non-public row, or a row with no image → 404. It
 * can NEVER serve an arbitrary private asset — it only resolves these two
 * public catalogs by id and only when the parent is public/active. It does NOT
 * reuse the admin-gated /api/admin/asset-categories/[id]/image proxy.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ kind: string; id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { kind, id } = await params

  if (kind === 'supply') {
    // Same public gate as /api/public/catalog — image is servable only if its
    // parent supply item is publicly orderable.
    const item = await prisma.inventoryItem.findFirst({
      where: { id, publicVisible: true, isActive: true, categoryId: { not: null } },
      select: { imageUrl: true },
    })
    if (!item?.imageUrl) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return streamPrivateBlobAsResponse({ fileUrl: item.imageUrl, filename: `${id}.jpg` })
  }

  if (kind === 'vehicle') {
    const vc = await prisma.vehicleCategory.findFirst({
      where: { id, active: true },
      select: { photoUrl: true, assetCategory: { select: { imageUrl: true } } },
    })
    if (!vc) return NextResponse.json({ error: 'not found' }, { status: 404 })
    // Prefer the row's own photoUrl; else the linked Fleet Pricing category image.
    const fileUrl = vc.photoUrl ?? vc.assetCategory?.imageUrl ?? null
    if (!fileUrl) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return streamPrivateBlobAsResponse({ fileUrl, filename: `${id}.jpg` })
  }

  return NextResponse.json({ error: 'not found' }, { status: 404 })
}
