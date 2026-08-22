import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// Driver portal links are short-lived on purpose: the page they open
// accepts a licence upload with no login, so a leaked link should stop
// working quickly. 14 days covers "production books Tuesday, driver
// uploads over the weekend" without leaving links live for months.
const LINK_TTL_DAYS = 14

/**
 * POST /api/drivers/[id]/invite — mint (or re-mint) this driver's portal
 * token and return the link. Minting REPLACES any previous token, so
 * re-sending a link silently revokes the old one.
 *
 * The response is the only place the full link exists — it is not stored
 * anywhere a later GET can read it back, same posture as order portal
 * access.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const { id } = await params
  const driver = await prisma.driver.findUnique({ where: { id }, select: { id: true } })
  if (!driver) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const token = randomUUID()
  const now = new Date()
  const expires = new Date(now.getTime() + LINK_TTL_DAYS * 24 * 60 * 60 * 1000)
  await prisma.driver.update({
    where: { id },
    data: { portalToken: token, portalTokenAt: now, portalExpiresAt: expires },
  })
  const base = process.env.NEXT_PUBLIC_PORTAL_URL || 'https://tsx.sirreel.com'
  return NextResponse.json({
    ok: true,
    url: `${base}/driver/${token}`,
    expiresAt: expires,
  })
}
