import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * POST /api/drivers/[id]/verify-license — a human accepts (or un-accepts)
 * the licence on file. This is the ONLY signal in the system that means
 * "a person looked at this": the AI read is an assist and never sets it.
 * Body: { verified: boolean }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const { id } = await params
  const body = await req.json().catch(() => null)
  const verified = body?.verified !== false
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  const driver = await prisma.driver.update({
    where: { id },
    data: {
      licenseVerified: verified,
      licenseVerifiedAt: verified ? new Date() : null,
      licenseVerifiedById: verified ? (user?.id ?? null) : null,
    },
    select: { id: true, licenseVerified: true, licenseVerifiedAt: true },
  })
  return NextResponse.json({ ok: true, driver })
}
