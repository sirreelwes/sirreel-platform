/**
 * GET /api/fleet/[id]/bit/[bitId]/pdf — streams an inspection PDF back
 * through the gated private-blob proxy. The stored pdfBlobKey points at a
 * PRIVATE blob (403 on direct fetch), so links MUST target this route, not
 * the raw blob URL.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireDispatchAccess } from '@/lib/fleet/requireDispatchAccess'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'
import { vehicleDocShortLabel } from '@/lib/fleet/vehicleDocs'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string; bitId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireDispatchAccess()
  if (!auth.ok) return auth.response
  const { id, bitId } = await params

  const bit = await prisma.bitInspection.findUnique({
    where: { id: bitId },
    select: {
      pdfBlobKey: true, assetId: true, inspectionDate: true,
      // The saved file is named for what the certificate actually IS: a
      // passenger van's says BIT across the top, and that is the folder
      // Julian files it in.
      asset: { select: { unitName: true, category: { select: { name: true } } } },
    },
  })
  if (!bit || bit.assetId !== id) {
    return NextResponse.json({ error: 'inspection not found' }, { status: 404 })
  }
  const stamp = bit.inspectionDate.toISOString().slice(0, 10)
  const word = vehicleDocShortLabel('bit-certificate', bit.asset?.category?.name)
  const unit = (bit.asset?.unitName ?? '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const filename = `${unit ? `${unit}_` : ''}${word}-inspection-${stamp}.pdf`
  return streamPrivateBlobAsResponse({ fileUrl: bit.pdfBlobKey, filename })
}
