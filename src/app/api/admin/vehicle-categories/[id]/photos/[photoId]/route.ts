/**
 * Admin management of ONE vehicle gallery photo. All verbs 404 unless the
 * photo belongs to the vehicle in the path (photoId is never trusted alone).
 *
 * GET    — streams the image back through the gated private-blob proxy for the
 *          editor preview (`<img src>` MUST target this, not the raw blob URL —
 *          the public proxy won't serve unpublished vehicles).
 * PATCH  — { isPrimary: true } promotes this photo to primary (demotes the
 *          rest); { sortOrder: n } re-orders it within the gallery.
 * DELETE — removes the row (does NOT garbage-collect the blob — matches the
 *          inventory/claims pattern). If the primary was deleted, the first
 *          remaining photo (sortOrder asc) is promoted so a gallery never ends
 *          up primary-less.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-admin'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string; photoId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const { id, photoId } = await params
  const photo = await prisma.vehicleCategoryPhoto.findFirst({
    where: { id: photoId, vehicleCategoryId: id },
    select: { url: true },
  })
  if (!photo) return NextResponse.json({ error: 'photo not found' }, { status: 404 })
  return streamPrivateBlobAsResponse({ fileUrl: photo.url, filename: `${photoId}.jpg` })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const { id, photoId } = await params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const existing = await prisma.vehicleCategoryPhoto.findFirst({
    where: { id: photoId, vehicleCategoryId: id },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: 'photo not found' }, { status: 404 })

  const wantsPrimary = body.isPrimary === true
  const sortOrder =
    body.sortOrder !== undefined && Number.isInteger(body.sortOrder) && (body.sortOrder as number) >= 0
      ? (body.sortOrder as number)
      : undefined
  if (body.sortOrder !== undefined && sortOrder === undefined) {
    return NextResponse.json({ error: 'sortOrder must be a non-negative integer' }, { status: 400 })
  }
  if (!wantsPrimary && sortOrder === undefined) {
    return NextResponse.json({ error: 'no editable fields provided' }, { status: 400 })
  }

  const photo = await prisma.$transaction(async (tx) => {
    if (wantsPrimary) {
      // Exactly one primary per vehicle — demote the others in the same tx.
      await tx.vehicleCategoryPhoto.updateMany({
        where: { vehicleCategoryId: id, isPrimary: true, id: { not: photoId } },
        data: { isPrimary: false },
      })
    }
    return tx.vehicleCategoryPhoto.update({
      where: { id: photoId },
      data: {
        ...(wantsPrimary ? { isPrimary: true } : {}),
        ...(sortOrder !== undefined ? { sortOrder } : {}),
      },
      select: { id: true, sortOrder: true, isPrimary: true },
    })
  })

  return NextResponse.json({ ok: true, photo })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const { id, photoId } = await params
  const existing = await prisma.vehicleCategoryPhoto.findFirst({
    where: { id: photoId, vehicleCategoryId: id },
    select: { id: true, isPrimary: true },
  })
  if (!existing) return NextResponse.json({ error: 'photo not found' }, { status: 404 })

  await prisma.$transaction(async (tx) => {
    await tx.vehicleCategoryPhoto.delete({ where: { id: photoId } })
    if (existing.isPrimary) {
      const next = await tx.vehicleCategoryPhoto.findFirst({
        where: { vehicleCategoryId: id },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      })
      if (next) {
        await tx.vehicleCategoryPhoto.update({ where: { id: next.id }, data: { isPrimary: true } })
      }
    }
  })

  return NextResponse.json({ ok: true })
}
