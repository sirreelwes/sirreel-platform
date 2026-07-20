import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

// GET /api/agreements/company/[id] — authed team download of an on-file
// (master / annual) agreement PDF. Private-blob proxy; agreements are
// sensitive contract docs.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const agreement = await prisma.companyAgreement.findUnique({
    where: { id: params.id },
    select: { fileUrl: true, originalFilename: true, deletedAt: true },
  })
  if (!agreement || agreement.deletedAt) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return streamPrivateBlobAsResponse({ fileUrl: agreement.fileUrl, filename: agreement.originalFilename })
}
