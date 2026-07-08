/**
 * /api/admin/site-settings — manage the public marketing site's Home
 * hero media (requireAdmin on every method).
 *
 *   GET    → { heroPoster, heroVideo, heroVideoMobile: boolean, updatedAt }
 *   POST   → multipart { slot, file }, slot ∈
 *              'hero-poster'       (JPG/PNG/WebP/HEIC — required fallback)
 *              'hero-video'        (MP4/WebM — desktop loop)
 *              'hero-video-mobile' (MP4/WebM — lighter <768px loop)
 *            uploads to the PRIVATE Blob store (shared uploadPrivateImage)
 *            and persists the URL on the SiteSetting singleton.
 *   DELETE → ?slot=hero-video | hero-video-mobile clears that field. The
 *            poster is required and is replaced (not removed) via POST.
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

// slot → { db field, is it a video }
const SLOT = {
  'hero-poster': { field: 'heroPosterUrl' as const, video: false },
  'hero-video': { field: 'heroVideoUrl' as const, video: true },
  'hero-video-mobile': { field: 'heroVideoMobileUrl' as const, video: true },
}
type SlotKey = keyof typeof SLOT

// Editable public-page hero titles: request key → SiteSetting column. The
// public pages fall back to built-in defaults (pageTitleDefaults.ts) when a
// column is null, so an empty submission clears the override.
const TITLE_FIELDS = {
  standingSets: 'titleStandingSets',
  vehicles: 'titleVehicles',
  contact: 'titleContact',
} as const
type TitleKey = keyof typeof TITLE_FIELDS
const TITLE_MAX = 200

export async function GET() {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const s = await prisma.siteSetting.findUnique({
    where: { id: SINGLETON },
    select: {
      heroPosterUrl: true, heroVideoUrl: true, heroVideoMobileUrl: true, updatedAt: true,
      titleStandingSets: true, titleVehicles: true, titleContact: true,
    },
  })
  return NextResponse.json({
    heroPoster: !!s?.heroPosterUrl,
    heroVideo: !!s?.heroVideoUrl,
    heroVideoMobile: !!s?.heroVideoMobileUrl,
    updatedAt: s?.updatedAt ?? null,
    titles: {
      standingSets: s?.titleStandingSets ?? '',
      vehicles: s?.titleVehicles ?? '',
      contact: s?.titleContact ?? '',
    },
  })
}

// PUT — save editable public-page hero titles. JSON body with any of
// { standingSets, vehicles, contact }: string. A blank/whitespace value clears
// the override (column → null → the page's built-in default renders).
export async function PUT(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 })
  }

  const data: Record<string, string | null> = {}
  for (const key of Object.keys(TITLE_FIELDS) as TitleKey[]) {
    if (!(key in body)) continue
    const v = (body as Record<string, unknown>)[key]
    if (v !== null && typeof v !== 'string') {
      return NextResponse.json({ error: `${key} must be a string` }, { status: 400 })
    }
    const trimmed = typeof v === 'string' ? v.trim() : ''
    data[TITLE_FIELDS[key]] = trimmed.length ? trimmed.slice(0, TITLE_MAX) : null
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'no title fields provided' }, { status: 400 })
  }

  await prisma.siteSetting.upsert({
    where: { id: SINGLETON },
    create: { id: SINGLETON, ...data },
    update: data,
  })
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const form = await req.formData().catch(() => null)
  const slotRaw = form?.get('slot')
  const file = form?.get('file')
  const slot = SLOT[slotRaw as SlotKey] ? (slotRaw as SlotKey) : null
  if (!slot) {
    return NextResponse.json({ error: 'slot must be hero-poster, hero-video, or hero-video-mobile' }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field required' }, { status: 400 })
  }

  const { field, video: isVideo } = SLOT[slot]
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
      filename: file.name || (isVideo ? 'hero.mp4' : 'hero.jpg'),
      contentType: file.type,
      data: buf,
    })
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

  const slotRaw = req.nextUrl.searchParams.get('slot')
  // Only the two videos are clearable; the poster is required.
  if (slotRaw !== 'hero-video' && slotRaw !== 'hero-video-mobile') {
    return NextResponse.json({ error: 'only hero-video or hero-video-mobile is clearable' }, { status: 400 })
  }
  const field = SLOT[slotRaw].field
  await prisma.siteSetting.upsert({
    where: { id: SINGLETON },
    create: { id: SINGLETON, [field]: null },
    update: { [field]: null },
  })
  return NextResponse.json({ ok: true })
}
