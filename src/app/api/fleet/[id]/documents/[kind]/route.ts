/**
 * GET    /api/fleet/[id]/documents/[kind] — stream the unit's registration or
 *          current BIT certificate through the gated private-blob proxy.
 * POST   /api/fleet/[id]/documents/registration — file a registration PDF
 *          (+ optional expiry) against the unit. Replaces what was there.
 * DELETE /api/fleet/[id]/documents/registration — clear the slot.
 *
 * `kind` is `registration` or `bit-certificate`. Only the registration is
 * writable here: the BIT pointer is stamped from the BIT-inspection history
 * (POST /api/fleet/[id]/bit) so one physical certificate can never end up as
 * two PDFs the portal and the DOT sheet disagree about. See vehicleDocs.ts.
 *
 * The stored URL is a PRIVATE blob that 403s on a direct fetch, so links MUST
 * target this route (staff) or /api/portal/job/vehicle-doc (clients), never
 * the raw blob URL.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireDispatchAccess } from '@/lib/fleet/requireDispatchAccess'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'
import { uploadPrivateImage } from '@/lib/blob/uploadPrivateImage'
import {
  VEHICLE_DOC_LABEL,
  isUploadableKind,
  parseVehicleDocKind,
  vehicleDocFilename,
  type VehicleDocKind,
} from '@/lib/fleet/vehicleDocs'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string; kind: string }> }

/** Mirrors the BIT upload cap. */
const MAX_BYTES = 25 * 1024 * 1024

const SLOT: Record<VehicleDocKind, { url: 'registrationUrl' | 'bitCertificateUrl'; exp: 'registrationExpiresAt' | 'bitCertificateExpiresAt' }> = {
  registration: { url: 'registrationUrl', exp: 'registrationExpiresAt' },
  'bit-certificate': { url: 'bitCertificateUrl', exp: 'bitCertificateExpiresAt' },
}

async function loadUnit(id: string) {
  return prisma.asset.findUnique({
    where: { id },
    select: {
      id: true,
      unitName: true,
      registrationUrl: true,
      registrationExpiresAt: true,
      bitCertificateUrl: true,
      bitCertificateExpiresAt: true,
    },
  })
}

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireDispatchAccess()
  if (!auth.ok) return auth.response
  const { id, kind: rawKind } = await params

  const kind = parseVehicleDocKind(rawKind)
  if (!kind) return NextResponse.json({ error: 'unknown document kind' }, { status: 404 })

  const asset = await loadUnit(id)
  if (!asset) return NextResponse.json({ error: 'unit not found' }, { status: 404 })

  const slot = SLOT[kind]
  const fileUrl = asset[slot.url]
  if (!fileUrl) {
    return NextResponse.json({ error: `no ${VEHICLE_DOC_LABEL[kind].toLowerCase()} on file for this unit` }, { status: 404 })
  }
  return streamPrivateBlobAsResponse({
    fileUrl,
    filename: vehicleDocFilename({ unitName: asset.unitName, kind, expiresAt: asset[slot.exp] }),
  })
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireDispatchAccess()
  if (!auth.ok) return auth.response
  const { id, kind: rawKind } = await params

  const kind = parseVehicleDocKind(rawKind)
  if (!kind) return NextResponse.json({ error: 'unknown document kind' }, { status: 404 })
  if (!isUploadableKind(kind)) {
    // Deliberate: see vehicleDocs.ts. The pointer follows the history.
    return NextResponse.json(
      {
        error: 'the BIT certificate is filed as a BIT inspection',
        reason: 'Upload it at POST /api/fleet/[id]/bit with its inspection date — the unit\'s current certificate follows the newest inspection on file.',
      },
      { status: 409 },
    )
  }

  const asset = await loadUnit(id)
  if (!asset) return NextResponse.json({ error: 'unit not found' }, { status: 404 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  const expiresRaw = String(form?.get('expiresAt') ?? '').trim()

  if (!(file instanceof File)) return NextResponse.json({ error: 'file field required' }, { status: 400 })

  // Expiry is OPTIONAL — a registration whose expiry nobody has keyed in is
  // still worth having in the cab, and refusing the upload over it would keep
  // the document off the portal entirely. When given it must be a real date:
  // it feeds the 30-day fleet-expirations alert.
  let expiresAt: Date | null = null
  if (expiresRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresRaw)) {
      return NextResponse.json({ error: 'expiresAt must be YYYY-MM-DD' }, { status: 400 })
    }
    expiresAt = new Date(`${expiresRaw}T00:00:00.000Z`)
    if (Number.isNaN(expiresAt.getTime())) {
      return NextResponse.json({ error: 'invalid expiresAt' }, { status: 400 })
    }
  }

  const buf = Buffer.from(await file.arrayBuffer())
  // Content-type OR the %PDF- magic header, same check as the BIT upload.
  const isPdf = file.type === 'application/pdf' || buf.subarray(0, 5).toString('latin1') === '%PDF-'
  if (!isPdf) return NextResponse.json({ error: 'registration must be a PDF' }, { status: 415 })
  if (buf.length > MAX_BYTES) {
    return NextResponse.json(
      { error: `PDF is ${(buf.length / 1024 / 1024).toFixed(1)} MB; cap is ${MAX_BYTES / 1024 / 1024} MB` },
      { status: 413 },
    )
  }

  try {
    const { fileUrl } = await uploadPrivateImage({
      keyPrefix: 'vehicle-registrations',
      ownerId: id,
      filename: file.name || 'registration.pdf',
      contentType: 'application/pdf',
      data: buf,
    })
    // The old blob is left in the store on purpose — a replace is not a
    // delete, and an orphaned PDF costs pennies where a wrongly-deleted
    // registration costs a roadside stop.
    await prisma.asset.update({
      where: { id },
      data: { registrationUrl: fileUrl, registrationExpiresAt: expiresAt },
    })
    await prisma.auditLog.create({
      data: {
        userId: auth.userId,
        action: 'asset.registration_filed',
        entityType: 'Asset',
        entityId: id,
        oldValues: { hadFile: !!asset.registrationUrl, expiresAt: asset.registrationExpiresAt },
        newValues: { hadFile: true, expiresAt },
      },
    }).catch(() => {})

    return NextResponse.json({
      ok: true,
      kind,
      hasFile: true,
      expiresAt,
      replaced: !!asset.registrationUrl,
    })
  } catch (err) {
    console.error('[fleet registration POST] upload failed:', err)
    return NextResponse.json(
      { error: 'Registration upload failed — please retry; if it persists, the blob store may be misconfigured.' },
      { status: 502 },
    )
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireDispatchAccess()
  if (!auth.ok) return auth.response
  const { id, kind: rawKind } = await params

  const kind = parseVehicleDocKind(rawKind)
  if (!kind) return NextResponse.json({ error: 'unknown document kind' }, { status: 404 })
  if (!isUploadableKind(kind)) {
    return NextResponse.json(
      {
        error: 'the BIT certificate cannot be cleared on its own',
        reason: 'It points at the newest BIT inspection on file. File a newer inspection to move it.',
      },
      { status: 409 },
    )
  }

  const asset = await loadUnit(id)
  if (!asset) return NextResponse.json({ error: 'unit not found' }, { status: 404 })

  await prisma.asset.update({
    where: { id },
    data: { registrationUrl: null, registrationExpiresAt: null },
  })
  await prisma.auditLog.create({
    data: {
      userId: auth.userId,
      action: 'asset.registration_cleared',
      entityType: 'Asset',
      entityId: id,
      oldValues: { hadFile: !!asset.registrationUrl, expiresAt: asset.registrationExpiresAt },
      newValues: { hadFile: false, expiresAt: null },
    },
  }).catch(() => {})

  return NextResponse.json({ ok: true, kind, hasFile: false, expiresAt: null })
}
