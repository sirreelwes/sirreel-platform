import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { get } from '@vercel/blob'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sessionUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!sessionUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const record = await prisma.contractReview.findFirst({
    where: { id: params.id, deletedAt: null },
    select: {
      counterPdfKey: true,
      counterGeneratedAt: true,
      originalFilename: true,
    },
  })

  if (!record) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (!record.counterPdfKey) {
    return NextResponse.json({ error: 'Counter-PDF has not been generated.' }, { status: 404 })
  }

  try {
    const blob = await get(record.counterPdfKey, { access: 'private' })
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return NextResponse.json({ error: 'File not available' }, { status: 502 })
    }

    const contentType = blob.blob.contentType || 'application/pdf'
    const baseName = record.originalFilename
      .replace(/\.pdf$/i, '')
      .replace(/"/g, '')
      .replace(/[\r\n]/g, '')
    const safeName = `${baseName}-counter.pdf`
    const headers = new Headers()
    headers.set('Content-Type', contentType)
    headers.set('Content-Disposition', `inline; filename="${safeName}"`)
    if (blob.blob.size != null) headers.set('Content-Length', String(blob.blob.size))

    return new NextResponse(blob.stream, { status: 200, headers })
  } catch (err) {
    console.error('GET /api/tools/contract-review/[id]/counter-pdf error:', err)
    return NextResponse.json({ error: 'Failed to fetch counter-PDF' }, { status: 500 })
  }
}
