import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

// GET /api/wc/download/[id] — authed team download of a stored Workers'
// Comp certificate. `id` is the PaperworkRequest id (WC lives on the
// booking's paperwork request, unlike COI which has its own row).
// Private-blob proxy via the shared streamBlob helper, same as
// /api/coi/download/[id] — WC certs are insurance documents.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const { id } = await params
  const pr = await prisma.paperworkRequest.findUnique({
    where: { id },
    select: { wcFileUrl: true, wcOriginalFilename: true },
  })
  if (!pr?.wcFileUrl) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  return streamPrivateBlobAsResponse({
    fileUrl: pr.wcFileUrl,
    filename: pr.wcOriginalFilename || 'workers-comp',
  })
}
