import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

// GET /api/coi/download/[id] — authed team download of a stored COI.
// Private-blob proxy via the shared streamBlob helper (COIs are sensitive).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const { id } = await params
  const coi = await prisma.coiCheck.findUnique({
    where: { id },
    select: { fileUrl: true, originalFilename: true, deletedAt: true },
  })
  if (!coi || coi.deletedAt) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  return streamPrivateBlobAsResponse({ fileUrl: coi.fileUrl, filename: coi.originalFilename })
}
