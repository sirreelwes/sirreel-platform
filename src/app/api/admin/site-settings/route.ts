/**
 * /api/admin/site-settings — manage the public marketing site's Home
 * hero media (requireAdmin on every method).
 *
 *   GET    → { heroImage: boolean, heroVideo: boolean, updatedAt }
 *   POST   → multipart { slot: 'hero-image' | 'hero-video', file }
 *            uploads to the PRIVATE Blob store (shared uploadPrivateImage)
 *            and persists the URL on the SiteSetting singleton.
 *   DELETE → ?slot=hero-video clears that field (poster stays required;
 *            hero-image is not clearable here — replace it via POST).
 *
 * Media is served publicly through /api/public/site-media/[slot] — the
 * raw private blob URL is never returned to the client.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-admin'
import { uploadPrivateImage } from '@/lib/blob/uploadPrivateImage'

export const dynamic = 'force-dynamic'

const SINGLETON = 'singleton'
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const VIDEO_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime'])
const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10 MB — mirrors the vehicle-photo cap
const MAX_VIDEO_BYTES = 50 * 1024 * 1024 // 50 MB — short muted loop, kept lean

export async function GET() {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const s = await prisma.siteSetting.findUnique({
    where: { id: SINGLETON },
    select: { heroImageUrl: true, heroVideoUrl: true, updatedAt: true },
  })
  return NextResponse.json({
    heroImage: !!s?.heroImageUrl,
    heroVideo: !!s?.heroVideoUrl,
    updatedAt: s?.updatedAt ?? null,
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const form = await req.formData().catch(() => null)
  const slot = form?.get('slot')
  const file = form?.get('file')
  if (slot !== 'hero-image' && slot !== 'hero-video') {
    return NextResponse.json({ error: 'slot must be hero-image or hero-video' }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field required' }, { status: 400 })
  }

  const isVideo = slot === 'hero-video'
  const allowed = isVideo ? VIDEO_MIME : IMAGE_MIME
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES
  if (!allowed.has(file.type)) {
    return NextResponse.json(
      {
        error: isVideo
          ? `unsupported video type "${file.type}" — use mp4 / webm`
          : `unsupported image type "${file.type}" — use jpg / png / webp / heic`,
      },
      { status: 415 },
    )
  }
  if (file.size > maxBytes) {
    return NextResponse.json(
      { error: `file is ${(file.size / 1024 / 1024).toFixed(1)} MB; cap is ${maxBytes / 1024 / 1024} MB` },
      { status: 413 },
    )
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer())
    const { fileUrl } = await uploadPrivateImage({
      keyPrefix: 'site-hero',
      ownerId: slot,
      filename: file.name || (isVideo ? 'hero.mp4' : 'hero'),
      contentType: file.type,
      data: buf,
    })
    const field = isVideo ? 'heroVideoUrl' : 'heroImageUrl'
    await prisma.siteSetting.upsert({
      where: { id: SINGLETON },
      create: { id: SINGLETON, [field]: fileUrl },
      update: { [field]: fileUrl },
    })
    return NextResponse.json({ ok: true, slot })
  } catch (err) {
    console.error('[site-settings POST] upload failed:', err)
    return NextResponse.json(
      { error: 'Storage upload failed — please retry; if it persists, the blob store may be misconfigured.' },
      { status: 502 },
    )
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const slot = req.nextUrl.searchParams.get('slot')
  if (slot !== 'hero-video') {
    // Only the optional video is clearable; the poster is required and is
    // replaced (not removed) via POST.
    return NextResponse.json({ error: 'only hero-video is clearable' }, { status: 400 })
  }
  await prisma.siteSetting.upsert({
    where: { id: SINGLETON },
    create: { id: SINGLETON, heroVideoUrl: null },
    update: { heroVideoUrl: null },
  })
  return NextResponse.json({ ok: true })
}
