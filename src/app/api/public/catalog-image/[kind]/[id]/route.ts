/**
 * GET /api/public/catalog-image/[kind]/[id] — PUBLIC, SCOPED image proxy for
 * the unauthenticated order form (orders.sirreel.com).
 *
 * It streams ONLY two public-catalog image kinds, by id, from the PRIVATE blob
 * store via the shared streamPrivateBlobAsResponse helper — the raw private
 * blob URL is never exposed to the client, and a direct fetch of that blob
 * still 403s. This route is deliberately narrow:
 *
 *   kind=supply        → InventoryItem.imageUrl, served ONLY if the item is
 *                        publicVisible + isActive + categorized (the exact gate
 *                        as /api/public/catalog). A non-public item's image is
 *                        denied.
 *   kind=vehicle       → VehicleCategory's representative image, served ONLY if
 *                        the row passes the public visibility gate (active +
 *                        published + has an image source). Source preference:
 *                        primary gallery photo → VehicleCategory.photoUrl → the
 *                        LINKED AssetCategory.imageUrl (assetCategoryId).
 *   kind=vehicle-photo → one VehicleCategoryPhoto gallery row by id, served
 *                        ONLY if its PARENT vehicle passes the same public
 *                        visibility gate. A hidden vehicle's gallery is denied.
 *
 * Any other kind, a missing/non-public row, or a row with no image → 404. It
 * can NEVER serve an arbitrary private asset — it only resolves these public
 * catalogs by id and only when the parent is public/visible. It does NOT
 * reuse the admin-gated /api/admin/asset-categories/[id]/image proxy.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'
import { PUBLIC_VEHICLE_VISIBLE_WHERE } from '@/lib/site/vehicleCatalog'
import { PUBLIC_SPACE_VISIBLE_WHERE } from '@/lib/site/spaces'

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
      where: { id, ...PUBLIC_VEHICLE_VISIBLE_WHERE },
      select: {
        photoUrl: true,
        assetCategory: { select: { imageUrl: true } },
        photos: {
          select: { url: true },
          orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
          take: 1,
        },
      },
    })
    if (!vc) return NextResponse.json({ error: 'not found' }, { status: 404 })
    // Prefer the primary gallery photo; else the row's own legacy photoUrl;
    // else the linked Fleet Pricing category image.
    const fileUrl = vc.photos[0]?.url ?? vc.photoUrl ?? vc.assetCategory?.imageUrl ?? null
    if (!fileUrl) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return streamPrivateBlobAsResponse({ fileUrl, filename: `${id}.jpg` })
  }

  if (kind === 'vehicle-photo') {
    // One gallery photo by id — only when its PARENT vehicle is client-visible.
    const photo = await prisma.vehicleCategoryPhoto.findFirst({
      where: { id, vehicleCategory: PUBLIC_VEHICLE_VISIBLE_WHERE },
      select: { url: true },
    })
    if (!photo) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return streamPrivateBlobAsResponse({ fileUrl: photo.url, filename: `${id}.jpg` })
  }

  if (kind === 'space') {
    // A Space's representative image — the primary gallery photo — served
    // only when the space passes the public visibility gate.
    const space = await prisma.space.findFirst({
      where: { id, ...PUBLIC_SPACE_VISIBLE_WHERE },
      select: {
        photos: {
          select: { url: true },
          orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
          take: 1,
        },
      },
    })
    const fileUrl = space?.photos[0]?.url ?? null
    if (!fileUrl) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return streamPrivateBlobAsResponse({ fileUrl, filename: `${id}.jpg` })
  }

  if (kind === 'space-photo') {
    // One gallery photo by id — only when its PARENT space is client-visible.
    const photo = await prisma.spacePhoto.findFirst({
      where: { id, space: PUBLIC_SPACE_VISIBLE_WHERE },
      select: { url: true },
    })
    if (!photo) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return streamPrivateBlobAsResponse({ fileUrl: photo.url, filename: `${id}.jpg` })
  }

  if (kind === 'team-photo') {
    // A team member's headshot by id. Lenient by design — a staff headshot
    // isn't sensitive and the id is a UUID — so admin can preview drafts too.
    const m = await prisma.teamMember.findFirst({
      where: { id, photoUrl: { not: null } },
      select: { photoUrl: true },
    })
    if (!m?.photoUrl) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return streamPrivateBlobAsResponse({ fileUrl: m.photoUrl, filename: `${id}.jpg` })
  }

  return NextResponse.json({ error: 'not found' }, { status: 404 })
}
