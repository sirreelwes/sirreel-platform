/**
 * GET    /api/admin/asset-categories/[id]/image — streams the category's
 *          representative photo back through the gated private-blob proxy.
 *          The stored imageUrl points at a PRIVATE blob (403 on direct
 *          fetch), so `<img src>` MUST target this route, not the raw blob
 *          URL. 404 when the category has no photo.
 * POST   /api/admin/asset-categories/[id]/image — multipart upload of one
 *          image file. Validates type + size, persists imageUrl.
 * DELETE /api/admin/asset-categories/[id]/image — clears imageUrl (does NOT
 *          garbage-collect the blob — matches the inventory/claims pattern).
 *
 * Reuses the existing private-Blob pipeline end-to-end: the shared
 * `uploadPrivateImage` writer (access:'private') and the shared
 * `streamPrivateBlobAsResponse` proxy helper. No new upload/serve path.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-admin'
import { uploadPrivateImage } from '@/lib/blob/uploadPrivateImage'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB — mirrors the inventory route cap

export async function GET(_req: NextRequest, { params }: Params) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const { id } = await params
  const cat = await prisma.assetCategory.findUnique({ where: { id }, select: { imageUrl: true, slug: true } })
  if (!cat) return NextResponse.json({ error: 'category not found' }, { status: 404 })
  if (!cat.imageUrl) return NextResponse.json({ error: 'no image on file' }, { status: 404 })
  return streamPrivateBlobAsResponse({ fileUrl: cat.imageUrl, filename: `${cat.slug}.jpg` })
}

export async function POST(req: NextRequest, { params }: Params) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const { id } = await params
  const existing = await prisma.assetCategory.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: 'category not found' }, { status: 404 })

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

  try {
    const buf = Buffer.from(await file.arrayBuffer())
    const { fileUrl } = await uploadPrivateImage({
      keyPrefix: 'asset-categories',
      ownerId: id,
      filename: file.name || 'image',
      contentType: file.type,
      data: buf,
    })
    const updated = await prisma.assetCategory.update({
      where: { id },
      data: { imageUrl: fileUrl },
      select: { id: true, slug: true, imageUrl: true },
    })
    return NextResponse.json({ ok: true, category: updated })
  } catch (err) {
    console.error('[asset-category image POST] upload failed:', err)
    return NextResponse.json(
      { error: 'Image storage upload failed — please retry; if it persists, the blob store may be misconfigured.' },
      { status: 502 },
    )
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const { id } = await params
  const updated = await prisma.assetCategory
    .update({ where: { id }, data: { imageUrl: null }, select: { id: true, slug: true, imageUrl: true } })
    .catch(() => null)
  if (!updated) return NextResponse.json({ error: 'category not found' }, { status: 404 })
  return NextResponse.json({ ok: true, category: updated })
}
