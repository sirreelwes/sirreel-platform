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
    select: { addendumFileUrl: true, addendumFilename: true, deletedAt: true },
  })
  if (!addendum || addendum.deletedAt || !addendum.addendumFileUrl) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  return streamPrivateBlobAsResponse({ fileUrl: addendum.addendumFileUrl, filename: addendum.addendumFilename || 'addendum.pdf' })
}
