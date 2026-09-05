/** GET /api/public/vendor-hq/[token]/logo — the partner's mark, for their
 *  own HQ. Token-gated; inline SVG when we have it. */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { workspaceByToken } from '@/lib/hq-white-label/actions'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'
import { svgResponse } from '@/lib/companies/logoSvg'

export const dynamic = 'force-dynamic'

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
