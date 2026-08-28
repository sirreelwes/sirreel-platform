/**
 * One photo on a subcontracted vehicle. Every verb 404s unless the
 * photo belongs to the vehicle in the path — photoId is never trusted
 * on its own.
 *
 * GET    — streams the image through the gated private-blob proxy.
 *          `<img src>` MUST point here, never at the raw blob URL.
 * PATCH  — { isPrimary: true } promotes (demoting the rest in the same
 *          transaction); { sortOrder } re-orders; { caption } relabels.
 * DELETE — removes the row. Does NOT garbage-collect the blob, matching
 *          the inventory/claims/vehicle-catalog precedent. If the
 *          primary went, the next photo is promoted so a gallery is
 *          never left primary-less.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'
import { requireSubVehicleAccess } from '@/lib/sub-rentals/auth'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string; photoId: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const gate = await requireSubVehicleAccess()
  if (gate instanceof NextResponse) return gate

  const photo = await prisma.subcontractedVehiclePhoto.findFirst({
    where: { id: params.photoId, vehicleId: params.id },
    select: { url: true },
  })
  if (!photo) return NextResponse.json({ error: 'photo not found' }, { status: 404 })
  return streamPrivateBlobAsResponse({ fileUrl: photo.url, filename: `${params.photoId}.jpg` })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const gate = await requireSubVehicleAccess()
  if (gate instanceof NextResponse) return gate

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const existing = await prisma.subcontractedVehiclePhoto.findFirst({
    where: { id: params.photoId, vehicleId: params.id },
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
  const hasCaption = 'caption' in body
  if (!wantsPrimary && sortOrder === undefined && !hasCaption) {
    return NextResponse.json({ error: 'no editable fields provided' }, { status: 400 })
  }

  const photo = await prisma.$transaction(async (tx) => {
    if (wantsPrimary) {
      await tx.subcontractedVehiclePhoto.updateMany({
        where: { vehicleId: params.id, isPrimary: true, id: { not: params.photoId } },
        data: { isPrimary: false },
      })
    }
    return tx.subcontractedVehiclePhoto.update({
      where: { id: params.photoId },
      data: {
        ...(wantsPrimary ? { isPrimary: true } : {}),
        ...(sortOrder !== undefined ? { sortOrder } : {}),
        ...(hasCaption
          ? { caption: typeof body.caption === 'string' && body.caption.trim() ? body.caption.trim() : null }
          : {}),
      },
      select: { id: true, caption: true, sortOrder: true, isPrimary: true },
    })
  })

  return NextResponse.json({ ok: true, photo })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const gate = await requireSubVehicleAccess()
  if (gate instanceof NextResponse) return gate

  const existing = await prisma.subcontractedVehiclePhoto.findFirst({
    where: { id: params.photoId, vehicleId: params.id },
    select: { id: true, isPrimary: true },
  })
  if (!existing) return NextResponse.json({ error: 'photo not found' }, { status: 404 })

  await prisma.$transaction(async (tx) => {
    await tx.subcontractedVehiclePhoto.delete({ where: { id: params.photoId } })
    if (existing.isPrimary) {
      const next = await tx.subcontractedVehiclePhoto.findFirst({
        where: { vehicleId: params.id },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      })
      if (next) {
        await tx.subcontractedVehiclePhoto.update({ where: { id: next.id }, data: { isPrimary: true } })
      }
    }
  })

  return NextResponse.json({ ok: true })
}
