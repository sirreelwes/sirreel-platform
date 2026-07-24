import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

/**
 * GET    /api/jobs/documents/[docId] — authed private-blob proxy download.
 * DELETE /api/jobs/documents/[docId] — soft-delete (keeps the blob + audit
 *        trail; the row just stops listing).
 *
 * Quotes/invoices are commercially sensitive, so the blob is private and
 * only ever served through this authed proxy — never a raw blob URL.
 */
export async function GET(_req: NextRequest, { params }: { params: { docId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const doc = await prisma.jobDocument.findUnique({
    where: { id: params.docId },
    select: { fileUrl: true, originalFilename: true, deletedAt: true },
  })
  if (!doc || doc.deletedAt) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return streamPrivateBlobAsResponse({ fileUrl: doc.fileUrl, filename: doc.originalFilename })
}

export async function DELETE(_req: NextRequest, { params }: { params: { docId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const doc = await prisma.jobDocument.findUnique({
    where: { id: params.docId },
    select: { id: true, deletedAt: true },
  })
  if (!doc || doc.deletedAt) return NextResponse.json({ error: 'not found' }, { status: 404 })

  await prisma.jobDocument.update({
    where: { id: params.docId },
    data: { deletedAt: new Date() },
  })
  return NextResponse.json({ ok: true })
}
