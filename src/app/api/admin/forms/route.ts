/**
 * /api/admin/forms — manage the public marketing site's downloadable
 * forms (requireAdmin on every method).
 *
 *   GET    → { coi, w9, rentalAgreement, studioContract: boolean, updatedAt }
 *   POST   → multipart { slot, file }, slot ∈
 *              'coi' | 'w9' | 'rental-agreement' | 'studio-contract'
 *            uploads a PDF to the PRIVATE Blob store and persists the URL
 *            on the SiteSetting singleton.
 *   DELETE → ?slot=<slot> clears that form field.
 *
 * PUBLIC forms only. There are intentionally NO slots for ACH / wire /
 * payment info (request-only via the contact intake) or Credit-Card
 * Authorization (CardPointe's domain — SirReel never stores/serves card
 * data). Forms are served publicly through /api/public/forms/[slot];
 * the raw private blob URL is never returned to the client.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-admin'
import { uploadPrivateImage } from '@/lib/blob/uploadPrivateImage'

export const dynamic = 'force-dynamic'

const SINGLETON = 'singleton'
const PDF_MIME = new Set(['application/pdf'])
const MAX_BYTES = 15 * 1024 * 1024 // 15 MB — generous for a scanned agreement

const SLOT = {
  coi: 'formCoiUrl',
  w9: 'formW9Url',
  'rental-agreement': 'formRentalAgreementUrl',
  'studio-contract': 'formStudioContractUrl',
} as const
type SlotKey = keyof typeof SLOT

export async function GET() {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const s = await prisma.siteSetting.findUnique({
    where: { id: SINGLETON },
    select: { formCoiUrl: true, formW9Url: true, formRentalAgreementUrl: true, formStudioContractUrl: true, updatedAt: true },
  })
  return NextResponse.json({
    coi: !!s?.formCoiUrl,
    w9: !!s?.formW9Url,
    rentalAgreement: !!s?.formRentalAgreementUrl,
    studioContract: !!s?.formStudioContractUrl,
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
    return NextResponse.json({ error: 'slot must be coi, w9, rental-agreement, or studio-contract' }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field required' }, { status: 400 })
  }
  if (!PDF_MIME.has(file.type)) {
    return NextResponse.json({ error: `unsupported type "${file.type}" — upload a PDF` }, { status: 415 })
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
      keyPrefix: 'site-forms',
      ownerId: slot,
      filename: file.name || `${slot}.pdf`,
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
    console.error('[admin/forms POST] upload failed:', err)
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
  if (!slot) {
    return NextResponse.json({ error: 'unknown slot' }, { status: 400 })
  }
  const field = SLOT[slot]
  await prisma.siteSetting.upsert({
    where: { id: SINGLETON },
    create: { id: SINGLETON, [field]: null },
    update: { [field]: null },
  })
  return NextResponse.json({ ok: true })
}
