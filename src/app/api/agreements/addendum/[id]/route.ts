import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

// GET /api/agreements/addendum/[id] — authed download of a job's signed
// addendum page (the doc that adds the job to the on-file master).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const addendum = await prisma.jobAgreementAddendum.findUnique({
    where: { id: params.id },
    select: {
      addendumFileUrl: true, addendumFilename: true, deletedAt: true,
      combinedFileUrl: true, combinedFilename: true,
    },
  })
  if (!addendum || addendum.deletedAt) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  // ?doc=combined — the master and this addendum stapled into one PDF, which
  // is what "the agreement for this job" means to anyone outside HQ (Wes,
  // 2026-09-02). Falls back to the addendum alone when the staple failed or
  // predates it, rather than 404ing: half the document beats none, and the
  // addendum is the half that carries what the client elected.
  const wantCombined = _req.nextUrl.searchParams.get('doc') === 'combined'
  const fileUrl =
    (wantCombined ? addendum.combinedFileUrl : null) ?? addendum.addendumFileUrl
  const filename =
    (wantCombined ? addendum.combinedFilename : null) ??
    addendum.addendumFilename ??
    'addendum.pdf'
  if (!fileUrl) return NextResponse.json({ error: 'not found' }, { status: 404 })

  return streamPrivateBlobAsResponse({
    fileUrl,
    filename,
    forceDownload: _req.nextUrl.searchParams.get('download') === '1',
  })
}
