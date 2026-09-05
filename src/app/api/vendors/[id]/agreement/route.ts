/** POST /api/vendors/[id]/agreement — staff file the partner agreement PDF
 *  to be signed (multipart: file, title, effectiveDate?, expiryDate?).
 *  GET streams the current one (signed copy if signed). */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSubRentalStaff } from '@/lib/sub-rentals/staffGate'
import { uploadVendorAgreement } from '@/lib/sub-rentals/vendorAccountActions'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireSubRentalStaff(); if ('error' in g) return g.error
  const a = await prisma.vendorAgreement.findFirst({ where: { vendorId: params.id, deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { title: true, fileUrl: true, signedFileUrl: true, originalFilename: true } })
  if (!a) return NextResponse.json({ error: 'none' }, { status: 404 })
  return streamPrivateBlobAsResponse({ fileUrl: a.signedFileUrl ?? a.fileUrl, filename: a.signedFileUrl ? `${a.title.replace(/\s+/g, '-')}-signed.pdf` : a.originalFilename, forceDownload: req.nextUrl.searchParams.get('download') === '1' })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireSubRentalStaff(); if ('error' in g) return g.error
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'Attach the agreement PDF.' }, { status: 400 })
  if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: 'Cap is 25 MB.' }, { status: 413 })
  const parseDate = (v: FormDataEntryValue | null) => { const s = typeof v === 'string' ? v.trim() : ''; if (!s) return null; const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d }
  try {
    const created = await uploadVendorAgreement({
      vendorId: params.id,
      title: typeof form?.get('title') === 'string' ? (form!.get('title') as string) : 'Partner Agreement',
      filename: file.name || 'partner-agreement.pdf',
      bytes: Buffer.from(await file.arrayBuffer()),
      effectiveDate: parseDate(form?.get('effectiveDate') ?? null),
      expiryDate: parseDate(form?.get('expiryDate') ?? null),
      byUserId: g.user.id,
    })
    return NextResponse.json({ ok: true, id: created.id })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: (e as { status?: number }).status ?? 500 })
  }
}
