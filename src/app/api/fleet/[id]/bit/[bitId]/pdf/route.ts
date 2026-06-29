/**
 * GET /api/fleet/[id]/bit/[bitId]/pdf — streams a BIT inspection PDF back
 * through the gated private-blob proxy. The stored pdfBlobKey points at a
 * PRIVATE blob (403 on direct fetch), so links MUST target this route, not
 * the raw blob URL.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireDispatchAccess } from '@/lib/fleet/requireDispatchAccess'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string; bitId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireDispatchAccess()
  if (!auth.ok) return auth.response
  const { id, bitId } = await params

  const bit = await prisma.bitInspection.findUnique({
    where: { id: bitId },
    select: { pdfBlobKey: true, assetId: true, inspectionDate: true },
  })
  if (!bit || bit.assetId !== id) {
    return NextResponse.json({ error: 'BIT inspection not found' }, { status: 404 })
  }
  const stamp = bit.inspectionDate.toISOString().slice(0, 10)
  return streamPrivateBlobAsResponse({ fileUrl: bit.pdfBlobKey, filename: `BIT-${stamp}.pdf` })
}
