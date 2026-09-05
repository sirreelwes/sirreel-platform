/** GET /api/public/vendor-account/[token]/agreement/pdf — the partner reads
 *  their agreement: the executed copy once signed, else the document to sign. */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { vendorByToken } from '@/lib/sub-rentals/vendorAccountActions'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

export async function HEAD(req: NextRequest, ctx: { params: { token: string } }) {
  return GET(req, ctx)
}

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const v = await vendorByToken(params.token)
  if (!v) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const a = await prisma.vendorAgreement.findFirst({
    where: { vendorId: v.id, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, fileUrl: true, signedFileUrl: true, originalFilename: true },
  })
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (req.method === 'HEAD') return new NextResponse(null, { status: 200, headers: { 'x-agreement-id': a.id } })
  return streamPrivateBlobAsResponse({
    fileUrl: a.signedFileUrl ?? a.fileUrl,
    filename: a.signedFileUrl ? `${a.title.replace(/\s+/g, '-')}-signed.pdf` : a.originalFilename,
    forceDownload: req.nextUrl.searchParams.get('download') === '1',
  })
}
