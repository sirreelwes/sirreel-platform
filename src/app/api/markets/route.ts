/**
 * GET /api/markets — the markets SirReel sells into.
 *
 * A market is a COMMERCIAL TERRITORY, not a geography: "Napa Valley", not
 * "NORCAL" (Wes, 2026-09-10). It is a table rather than an enum precisely so
 * opening one is a row somebody adds, not a schema change plus the two-stage
 * deploy an enum value needs.
 *
 * Returns ACTIVE markets in the hand-set display order. Retired markets stay
 * in the database so historical jobs keep resolving, but never appear in a
 * picker.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const markets = await prisma.market.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, slug: true },
  })
  return NextResponse.json({ ok: true, markets })
}
