/**
 * /api/public/vendor-account/[token]/units/[unitId]/photos
 *
 *   GET  → the unit's photos (ids + order; bytes come from the proxy beside it)
 *   POST → multipart upload of ONE photo, by the PARTNER
 *   DELETE → remove one of their own photos (?photoId=)
 *
 * The partner-side twin of /api/sub-rentals/vehicles/[id]/photos, which is
 * staff-only. Wes 2026-09-10: Evan should be able to put his own pictures on
 * his units rather than email them to us and wait.
 *
 * Same storage contract as the staff route — bytes to the PRIVATE blob store,
 * `url` never handed to a browser — and the same caps, so a photo a partner
 * adds is indistinguishable downstream from one HQ added.
 *
 * Auth is the account token, and every query is scoped `vendorId: v.id`, so a
 * partner token reaches only that partner's own units.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { uploadPrivateImage } from '@/lib/blob/uploadPrivateImage'
import { vendorByToken, notePartnerPhotoAdded } from '@/lib/sub-rentals/vendorAccountActions'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'

export const dynamic = 'force-dynamic'

type Params = { params: { token: string; unitId: string } }

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const MAX_BYTES = 10 * 1024 * 1024
/** A unit is a listing, not an album. Enough for every angle, few enough that
 *  nobody has to curate someone else's upload queue. */
const MAX_PHOTOS = 12

/**
 * The shared public policy is 5 requests / 10 minutes, which is right for a
 * form someone submits once and wrong here: the picker is multi-select and
 * uploads serially, so a partner choosing six photos would be told to slow
 * down after the fifth and lose the sixth. This endpoint is token-authed
 * (not anonymous) and capped at MAX_PHOTOS per unit anyway, so the limiter's
 * job is stopping a hammer, not counting a partner's photos.
 */
const UPLOAD_RATE = { windowMs: 10 * 60_000, max: 60 }

/** The unit, only if it belongs to the partner holding this token AND is one
 *  they offer to SirReel — the account page lists nothing else, and units kept
 *  to their own workspace are not ours to put pictures on. */
async function ownUnit(token: string, unitId: string) {
  const v = await vendorByToken(token)
  if (!v) return null
  const unit = await prisma.subcontractedVehicle.findFirst({
    where: { id: unitId, vendorId: v.id, offeredToSirReel: true },
    select: { id: true, name: true },
  })
  return unit ? { vendor: v, unit } : null
}

export async function GET(_req: NextRequest, { params }: Params) {
  const own = await ownUnit(params.token, params.unitId)
  if (!own) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const photos = await prisma.subcontractedVehiclePhoto.findMany({
    where: { vehicleId: own.unit.id },
    select: { id: true, caption: true, sortOrder: true, isPrimary: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
  return NextResponse.json({ photos })
}

export async function POST(req: NextRequest, { params }: Params) {
  if (!checkRateLimit(`vendor-account-photos:${clientIp(req)}`, UPLOAD_RATE).ok) return NextResponse.json({ error: 'That is a lot of photos at once — give it a minute.' }, { status: 429 })
  const own = await ownUnit(params.token, params.unitId)
  if (!own) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  const caption = form?.get('caption')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Choose a photo first.' }, { status: 400 })
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: `That is a ${file.type || 'file'} — use a JPG, PNG, WEBP or HEIC.` }, { status: 415 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `That photo is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_BYTES / 1024 / 1024} MB.` }, { status: 413 })
  }

  const existing = await prisma.subcontractedVehiclePhoto.count({ where: { vehicleId: own.unit.id } })
  if (existing >= MAX_PHOTOS) {
    return NextResponse.json({ error: `${own.unit.name} already has ${MAX_PHOTOS} photos — remove one first.` }, { status: 409 })
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer())
    const { fileUrl } = await uploadPrivateImage({
      keyPrefix: 'subcontracted-vehicle-photos',
      ownerId: own.unit.id,
      filename: file.name || 'image',
      contentType: file.type,
      data: buf,
    })
    const photo = await prisma.$transaction(async (tx) => {
      const agg = await tx.subcontractedVehiclePhoto.aggregate({
        where: { vehicleId: own.unit.id },
        _max: { sortOrder: true },
        _count: true,
      })
      return tx.subcontractedVehiclePhoto.create({
        data: {
          vehicleId: own.unit.id,
          url: fileUrl,
          caption: typeof caption === 'string' && caption.trim() ? caption.trim().slice(0, 200) : null,
          sortOrder: (agg._max.sortOrder ?? -1) + 1,
          isPrimary: agg._count === 0,
        },
        select: { id: true, caption: true, sortOrder: true, isPrimary: true },
      })
    })
    // Live already; this marks it as the partner's and tells HQ once per
    // burst (Wes 2026-09-11). Never blocks the upload.
    await notePartnerPhotoAdded({ vendorId: own.vendor.id, vendorName: own.vendor.name, unitId: own.unit.id, unitName: own.unit.name, photoId: photo.id }).catch(() => {})
    return NextResponse.json({ ok: true, photo })
  } catch (err) {
    console.error('[vendor-account photos POST] upload failed:', err)
    return NextResponse.json({ error: 'The upload did not go through — please try again.' }, { status: 502 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const own = await ownUnit(params.token, params.unitId)
  if (!own) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const photoId = new URL(req.url).searchParams.get('photoId')
  if (!photoId) return NextResponse.json({ error: 'photoId required' }, { status: 400 })

  // Scoped to THIS unit, so a token cannot delete a photo off another one.
  const photo = await prisma.subcontractedVehiclePhoto.findFirst({
    where: { id: photoId, vehicleId: own.unit.id },
    select: { id: true, isPrimary: true },
  })
  if (!photo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.$transaction(async (tx) => {
    await tx.subcontractedVehiclePhoto.delete({ where: { id: photo.id } })
    // Never leave a unit with photos but no primary — the catalog picks the
    // primary to lead with, and a null one renders as no photo at all.
    if (photo.isPrimary) {
      const next = await tx.subcontractedVehiclePhoto.findFirst({
        where: { vehicleId: own.unit.id },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      })
      if (next) await tx.subcontractedVehiclePhoto.update({ where: { id: next.id }, data: { isPrimary: true } })
    }
  })
  return NextResponse.json({ ok: true })
}
