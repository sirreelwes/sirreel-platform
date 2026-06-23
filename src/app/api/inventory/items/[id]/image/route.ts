/**
 * GET    /api/inventory/items/[id]/image — streams the item's photo
 *                                          back through the gated
 *                                          private-blob proxy. The
 *                                          stored imageUrl points at a
 *                                          PRIVATE blob (403 on direct
 *                                          fetch), so `<img src>` MUST
 *                                          target this route, not the
 *                                          raw blob URL. 404 when the
 *                                          item has no photo.
 * POST   /api/inventory/items/[id]/image — multipart upload of one
 *                                          image file. Validates type +
 *                                          size, persists imageUrl,
 *                                          returns the new URL.
 * DELETE /api/inventory/items/[id]/image — clears imageUrl on the
 *                                          record. Does NOT garbage-
 *                                          collect the blob (matches
 *                                          the claims-document pattern;
 *                                          orphan-cost is negligible).
 *
 * Auth: any authenticated session. Inventory edits are a daily-touch
 * surface for ops staff; tightening to ADMIN-only would block Hugo and
 * Julian who legitimately maintain rates/qty/photos.
 *
 * Storage: PRIVATE blob via @vercel/blob — see
 * src/lib/inventory/uploadInventoryImage.ts. Served via the proxy GET
 * above using the shared streamPrivateBlobAsResponse helper.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { uploadInventoryImage } from '@/lib/inventory/uploadInventoryImage'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

// Accept the four formats the spec calls out. HEIC passes through raw
// (client-side canvas resize doesn't run for HEIC in Chrome/FF; we
// store whatever the device emits and let downstream `<img>` tags
// render or fall back). 10 MB cap is generous for resized JPEGs and
// keeps the route memory-bounded.
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

async function requireSession() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return session.user.email
}

export async function GET(_req: NextRequest, { params }: Params) {
  const email = await requireSession()
  if (!email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const { id } = await params
  const item = await prisma.inventoryItem.findUnique({
    where: { id },
    select: { imageUrl: true, code: true },
  })
  if (!item) {
    return NextResponse.json({ error: 'inventory item not found' }, { status: 404 })
  }
  if (!item.imageUrl) {
    return NextResponse.json({ error: 'no image on file' }, { status: 404 })
  }
  return streamPrivateBlobAsResponse({ fileUrl: item.imageUrl, filename: `${item.code}.jpg` })
}

export async function POST(req: NextRequest, { params }: Params) {
  const email = await requireSession()
  if (!email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const { id } = await params

  // Confirm the item exists before we burn an upload — cheap pre-check
  // that surfaces a clear 404 vs an opaque foreign-key error later.
  const existing = await prisma.inventoryItem.findUnique({
    where: { id },
    select: { id: true, code: true },
  })
  if (!existing) {
    return NextResponse.json({ error: 'inventory item not found' }, { status: 404 })
  }

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field required' }, { status: 400 })
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: `unsupported image type "${file.type}" — use jpg / png / webp / heic` },
      { status: 415 },
    )
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `image is ${(file.size / 1024 / 1024).toFixed(1)} MB; cap is ${MAX_BYTES / 1024 / 1024} MB` },
      { status: 413 },
    )
  }

  // Blob upload + persist. Any failure here (e.g. a blob-store config
  // problem) must surface as a clean, specific error — never a bare
  // 500 that the modal renders as "Upload failed (HTTP 500)".
  try {
    const buf = Buffer.from(await file.arrayBuffer())
    const { fileUrl } = await uploadInventoryImage({
      itemId: id,
      filename: file.name || 'image',
      contentType: file.type,
      data: buf,
    })

    const updated = await prisma.inventoryItem.update({
      where: { id },
      data: { imageUrl: fileUrl },
      select: { id: true, code: true, imageUrl: true },
    })

    return NextResponse.json({ ok: true, item: updated })
  } catch (err) {
    console.error('[inventory image POST] upload failed:', err)
    return NextResponse.json(
      { error: 'Image storage upload failed — please retry; if it persists, the blob store may be misconfigured.' },
      { status: 502 },
    )
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const email = await requireSession()
  if (!email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const { id } = await params

  const updated = await prisma.inventoryItem
    .update({
      where: { id },
      data: { imageUrl: null },
      select: { id: true, code: true, imageUrl: true },
    })
    .catch(() => null)
  if (!updated) {
    return NextResponse.json({ error: 'inventory item not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, item: updated })
}
