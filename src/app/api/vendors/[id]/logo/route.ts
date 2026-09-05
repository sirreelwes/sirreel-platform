/** GET / POST / DELETE /api/vendors/[id]/logo — the partner's mark. Same
 *  pipeline as the company logo: private blob, inline SVG when vector. */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSubRentalStaff } from '@/lib/sub-rentals/staffGate'
import { uploadPrivateImage } from '@/lib/blob/uploadPrivateImage'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'
import { svgResponse } from '@/lib/companies/logoSvg'

export const dynamic = 'force-dynamic'
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'])

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireSubRentalStaff(); if ('error' in g) return g.error
  const v = await prisma.vendor.findUnique({ where: { id: params.id }, select: { name: true, logoUrl: true, logoSvg: true } })
  if (v?.logoSvg) return svgResponse(v.logoSvg)
  if (!v?.logoUrl) return NextResponse.json({ error: 'no logo' }, { status: 404 })
  return streamPrivateBlobAsResponse({ fileUrl: v.logoUrl, filename: `${v.name.replace(/[^A-Za-z0-9._-]+/g, '-')}-logo` })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireSubRentalStaff(); if ('error' in g) return g.error
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file field required' }, { status: 400 })
  if (!ALLOWED.has(file.type)) return NextResponse.json({ error: 'Use PNG, JPG, WEBP or SVG.' }, { status: 415 })
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'Cap is 5 MB.' }, { status: 413 })
  const bytes = Buffer.from(await file.arrayBuffer())
  const { fileUrl } = await uploadPrivateImage({ keyPrefix: 'vendor-logos', ownerId: params.id, filename: file.name || 'logo', contentType: file.type, data: bytes })
  const text = file.type === 'image/svg+xml' && bytes.length <= 256 * 1024 ? bytes.toString('utf8') : null
  const logoSvg = text && /<svg[\s>]/i.test(text.slice(0, 2000)) ? text : null
  await prisma.vendor.update({ where: { id: params.id }, data: { logoUrl: fileUrl, logoSvg, logoUploadedAt: new Date() } })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireSubRentalStaff(); if ('error' in g) return g.error
  await prisma.vendor.update({ where: { id: params.id }, data: { logoUrl: null, logoSvg: null, logoUploadedAt: null } }).catch(() => null)
  return NextResponse.json({ ok: true })
}
