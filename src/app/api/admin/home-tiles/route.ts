/**
 * /api/admin/home-tiles — manage the Home diagonal service-nav tile
 * images (requireAdmin on every method).
 *
 *   GET    → { trucking, stages, standingSets, ledWall, supplies: boolean, updatedAt }
 *   POST   → multipart { slot, file }, slot ∈
 *              'trucking' | 'stages' | 'standing-sets' | 'led-wall' | 'supplies'
 *            uploads an image to the PRIVATE Blob store and persists the
 *            URL on the SiteSetting singleton.
 *   DELETE → ?slot=<slot> clears that tile (falls back to solid color).
 *
 * Served publicly through /api/public/site-media/tile-[slot]; the raw
 * private blob URL is never returned to the client.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-admin'
import { uploadPrivateImage } from '@/lib/blob/uploadPrivateImage'

export const dynamic = 'force-dynamic'

const SINGLETON = 'singleton'
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const MAX_BYTES = 12 * 1024 * 1024 // 12 MB

const SLOT = {
  trucking: 'tileTruckingUrl',
  stages: 'tileStagesUrl',
  'standing-sets': 'tileStandingSetsUrl',
  'led-wall': 'tileLedWallUrl',
  supplies: 'tileSuppliesUrl',
} as const
type SlotKey = keyof typeof SLOT

export async function GET() {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const s = await prisma.siteSetting.findUnique({
    where: { id: SINGLETON },
    select: {
      tileTruckingUrl: true, tileStagesUrl: true, tileStandingSetsUrl: true,
      tileLedWallUrl: true, tileSuppliesUrl: true, updatedAt: true,
    },
  })
  return NextResponse.json({
    trucking: !!s?.tileTruckingUrl,
    stages: !!s?.tileStagesUrl,
    standingSets: !!s?.tileStandingSetsUrl,
    ledWall: !!s?.tileLedWallUrl,
    supplies: !!s?.tileSuppliesUrl,
    updatedAt: s?.updatedAt ?? null,
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const form = await req.formData().catch(() => null)
  const slotRaw = form?.get('slot')
  const file = form?.get('file')
  const slot = SLOT[slotRaw as SlotKey] ? (slotRaw as SlotKey) : null
  if (!slot) {
    return NextResponse.json({ error: 'slot must be trucking, stages, standing-sets, led-wall, or supplies' }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field required' }, { status: 400 })
  }
  if (!IMAGE_MIME.has(file.type)) {
    return NextResponse.json({ error: `unsupported image type "${file.type}" — use jpg / png / webp / heic` }, { status: 415 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file is ${(file.size / 1024 / 1024).toFixed(1)} MB; cap is ${MAX_BYTES / 1024 / 1024} MB` },
      { status: 413 },
    )
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer())
    const { fileUrl } = await uploadPrivateImage({
      keyPrefix: 'home-tiles',
      ownerId: slot,
      filename: file.name || `${slot}.jpg`,
      contentType: file.type,
      data: buf,
    })
    const field = SLOT[slot]
    await prisma.siteSetting.upsert({
      where: { id: SINGLETON },
      create: { id: SINGLETON, [field]: fileUrl },
      update: { [field]: fileUrl },
    })
    return NextResponse.json({ ok: true, slot })
  } catch (err) {
    console.error('[admin/home-tiles POST] upload failed:', err)
    return NextResponse.json(
      { error: 'Storage upload failed — please retry; if it persists, the blob store may be misconfigured.' },
      { status: 502 },
    )
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const slotRaw = req.nextUrl.searchParams.get('slot')
  const slot = SLOT[slotRaw as SlotKey] ? (slotRaw as SlotKey) : null
  if (!slot) return NextResponse.json({ error: 'unknown slot' }, { status: 400 })
  const field = SLOT[slot]
  await prisma.siteSetting.upsert({
    where: { id: SINGLETON },
    create: { id: SINGLETON, [field]: null },
    update: { [field]: null },
  })
  return NextResponse.json({ ok: true })
}
