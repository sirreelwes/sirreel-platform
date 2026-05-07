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
    select: { fileKey: true, mimeType: true, originalFilename: true },
  })

  if (!record) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (!record.fileKey) {
    // File was hard-deleted by the retention cron; record kept for audit
    return NextResponse.json(
      { error: 'File no longer available (retention cleanup).' },
      { status: 410 }
    )
  }

  try {
    const blob = await get(record.fileKey, { access: 'private' })
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return NextResponse.json({ error: 'File not available' }, { status: 502 })
    }

    const contentType = blob.blob.contentType || record.mimeType || 'application/pdf'
    const safeName = record.originalFilename.replace(/"/g, '').replace(/[\r\n]/g, '')
    const headers = new Headers()
    headers.set('Content-Type', contentType)
    headers.set('Content-Disposition', `inline; filename="${safeName}"`)
    if (blob.blob.size != null) headers.set('Content-Length', String(blob.blob.size))

    return new NextResponse(blob.stream, { status: 200, headers })
  } catch (err) {
    console.error('GET /api/tools/contract-review/[id]/file error:', err)
    return NextResponse.json({ error: 'Failed to fetch file' }, { status: 500 })
  }
}
