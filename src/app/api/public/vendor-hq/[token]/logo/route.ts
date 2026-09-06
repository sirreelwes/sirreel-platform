/** GET / POST / DELETE /api/public/vendor-hq/[token]/logo — the partner's
 *  mark, managed from THEIR workspace (no detour through any other
 *  company's page). Same blob pipeline as every logo here. */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { gateHq } from '@/lib/hq-white-label/routeGate'
import { workspaceByToken } from '@/lib/hq-white-label/actions'
import { uploadPrivateImage } from '@/lib/blob/uploadPrivateImage'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'
import { svgResponse } from '@/lib/companies/logoSvg'

export const dynamic = 'force-dynamic'
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'])

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const ws = await workspaceByToken(params.token)
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const row = await prisma.vendor.findUnique({ where: { id: ws.vendorId }, select: { logoUrl: true, logoSvg: true, name: true } })
  if (row?.logoSvg) return svgResponse(row.logoSvg)
  if (!row?.logoUrl) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const res = await streamPrivateBlobAsResponse({ fileUrl: row.logoUrl, filename: `${row.name.replace(/[^A-Za-z0-9._-]+/g, '-')}-logo` })
  res.headers.set('Cache-Control', 'private, max-age=3600')
  return res
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const g = await gateHq(req, params.token)
  if ('error' in g) return g.error
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Pick an image.' }, { status: 400 })
  if (!ALLOWED.has(file.type)) return NextResponse.json({ error: 'Use PNG, JPG, WEBP or SVG.' }, { status: 415 })
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'Cap is 5 MB.' }, { status: 413 })
  const bytes = Buffer.from(await file.arrayBuffer())
  const { fileUrl } = await uploadPrivateImage({ keyPrefix: 'vendor-logos', ownerId: g.ws.vendorId, filename: file.name || 'logo', contentType: file.type, data: bytes })
  const text = file.type === 'image/svg+xml' && bytes.length <= 256 * 1024 ? bytes.toString('utf8') : null
  const logoSvg = text && /<svg[\s>]/i.test(text.slice(0, 2000)) ? text : null
  await prisma.vendor.update({ where: { id: g.ws.vendorId }, data: { logoUrl: fileUrl, logoSvg, logoUploadedAt: new Date() } })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: { token: string } }) {
  const g = await gateHq(req, params.token)
  if ('error' in g) return g.error
  await prisma.vendor.update({ where: { id: g.ws.vendorId }, data: { logoUrl: null, logoSvg: null, logoUploadedAt: null } })
  return NextResponse.json({ ok: true })
}
