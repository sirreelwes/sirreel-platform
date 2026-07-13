import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { renderStageSignedCopyPdf } from '@/lib/contracts/renderStageSignedCopy'

export const dynamic = 'force-dynamic'

/**
 * GET /api/portal/v2/[token]/stage-contract-pdf
 *
 * The client's signed copy of the v2 studio contract, rendered on demand
 * from the signoff persisted by stage-sign — via the SAME shared renderer
 * (renderStageSignedCopy) stage-sign uses for the stored Blob artifact
 * and the internal staff email, so all three are identical. Negotiated
 * terms snapshot, studio T&Cs, the studio signature — and for
 * Hospital-Set jobs, the full populated Stryker Master Media Use
 * Agreement with its own signature block. Only available once signed.
 */
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const request = await prisma.paperworkRequest.findUnique({
      where: { token: params.token },
      include: { booking: { include: { company: true } } },
    })
    if (!request) return NextResponse.json({ error: 'Invalid token' }, { status: 404 })

    let sd: any = null
    try {
      sd = request.stageDetails ? JSON.parse(request.stageDetails) : null
    } catch {
      sd = null
    }
    const signoff = sd?.signoff
    if (!request.studioContractSigned || !signoff) {
      return NextResponse.json({ error: 'Studio contract has not been signed yet' }, { status: 404 })
    }

    const buffer = await renderStageSignedCopyPdf(request, signoff)

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="sirreel-studio-contract-${(request.booking?.jobName || 'signed').replace(/[^a-zA-Z0-9-_ ]/g, '').slice(0, 60)}.pdf"`,
      },
    })
  } catch (err: any) {
    console.error('[portal/v2/stage-contract-pdf]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
