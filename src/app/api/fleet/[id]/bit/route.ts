/**
 * GET  /api/fleet/[id]/bit  — list a unit's BIT inspections, latest first.
 * POST /api/fleet/[id]/bit  — upload one BIT inspection: a PDF scan + the
 *        inspection date (+ optional notes). The PDF goes to the SAME private
 *        Blob pipeline as COIs/photos (uploadPrivateImage, access:'private')
 *        and is served back only through the gated proxy — never a public URL.
 *
 * Filing an inspection also stamps the unit's CURRENT BIT CERTIFICATE
 * pointer (Asset.bitCertificateUrl / bitCertificateExpiresAt) at this PDF,
 * which is what the fleet-expirations cron alerts on and what the client
 * portal offers for the cab. There is deliberately no separate upload box for
 * that pointer — one physical certificate, one PDF. See
 * src/lib/fleet/vehicleDocs.ts. Backfilling an OLDER inspection files the
 * history row without moving the pointer.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireDispatchAccess } from '@/lib/fleet/requireDispatchAccess'
import { uploadPrivateImage } from '@/lib/blob/uploadPrivateImage'
import { shouldStampCurrentBit } from '@/lib/fleet/vehicleDocs'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const MAX_BYTES = 25 * 1024 * 1024 // 25 MB — mirrors the COI upload cap

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireDispatchAccess()
  if (!auth.ok) return auth.response
  const { id } = await params

  const rows = await prisma.bitInspection.findMany({
    where: { assetId: id },
    orderBy: { inspectionDate: 'desc' },
    select: { id: true, inspectionDate: true, notes: true, createdAt: true },
  })
  return NextResponse.json({ ok: true, inspections: rows })
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireDispatchAccess()
  if (!auth.ok) return auth.response
  const { id } = await params

  const asset = await prisma.asset.findUnique({ where: { id }, select: { id: true } })
  if (!asset) return NextResponse.json({ error: 'unit not found' }, { status: 404 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  const dateStr = String(form?.get('inspectionDate') ?? '').trim()
  const notes = String(form?.get('notes') ?? '').trim() || null
  const expiresRaw = String(form?.get('expiresAt') ?? '').trim()

  if (!(file instanceof File)) return NextResponse.json({ error: 'file field required' }, { status: 400 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NextResponse.json({ error: 'inspectionDate (YYYY-MM-DD) required' }, { status: 400 })
  }
  const inspectionDate = new Date(`${dateStr}T00:00:00.000Z`)
  if (Number.isNaN(inspectionDate.getTime())) {
    return NextResponse.json({ error: 'invalid inspectionDate' }, { status: 400 })
  }

  // Optional: what the certificate itself says it is good through. NOT derived
  // from the inspection date — the BIT cycle is a fact on the paper, and
  // inventing an interval here would put a made-up date in front of a client
  // and on the fleet alert. No expiry simply means no expiry alert.
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
  // Validate it's really a PDF — content-type OR the %PDF- magic header
  // (mirrors the COI upload's magic-byte check).
  const isPdf = file.type === 'application/pdf' || buf.subarray(0, 5).toString('latin1') === '%PDF-'
  if (!isPdf) return NextResponse.json({ error: 'BIT scan must be a PDF' }, { status: 415 })
  if (buf.length > MAX_BYTES) {
    return NextResponse.json({ error: `PDF is ${(buf.length / 1024 / 1024).toFixed(1)} MB; cap is ${MAX_BYTES / 1024 / 1024} MB` }, { status: 413 })
  }

  try {
    const { fileUrl } = await uploadPrivateImage({
      keyPrefix: 'bit-inspections',
      ownerId: id,
      filename: file.name || 'bit.pdf',
      contentType: 'application/pdf',
      data: buf,
    })
    const created = await prisma.bitInspection.create({
      data: { assetId: id, inspectionDate, pdfBlobKey: fileUrl, notes },
      select: { id: true, inspectionDate: true, notes: true, createdAt: true },
    })

    // Move the current-certificate pointer iff this is the newest inspection
    // on file. Read AFTER the insert and excluding the new row, so a
    // concurrent upload of a newer certificate cannot be overwritten by a
    // slower backfill that started first.
    const newestOther = await prisma.bitInspection.findFirst({
      where: { assetId: id, id: { not: created.id } },
      orderBy: { inspectionDate: 'desc' },
      select: { inspectionDate: true },
    })
    const isCurrent = shouldStampCurrentBit({
      newInspectionDate: inspectionDate,
      latestExistingDate: newestOther?.inspectionDate ?? null,
    })
    if (isCurrent) {
      await prisma.asset.update({
        where: { id },
        data: { bitCertificateUrl: fileUrl, bitCertificateExpiresAt: expiresAt },
      })
    }

    return NextResponse.json({ ok: true, inspection: created, isCurrent, expiresAt: isCurrent ? expiresAt : null })
  } catch (err) {
    console.error('[fleet BIT POST] upload failed:', err)
    return NextResponse.json(
      { error: 'BIT scan upload failed — please retry; if it persists, the blob store may be misconfigured.' },
      { status: 502 },
    )
  }
}
