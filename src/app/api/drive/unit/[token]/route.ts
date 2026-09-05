/**
 * GET /api/drive/unit/[token] — the partner's driver's page data.
 * No login: the token is the credential (minted when the partner named them,
 * rotated if the partner changes driver, so a replaced driver's link dies).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildDriverUnitView, subRentalForDriverToken, todayPacific } from '@/lib/sub-rentals/driverUnitView'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const row = await subRentalForDriverToken(params.token)
  if (!row) return NextResponse.json({ error: 'invalid link' }, { status: 404 })
  // Opened — stamp it so HQ and the partner can see the driver has the page.
  prisma.subRental
    .update({ where: { id: row.id }, data: { driverViewedAt: new Date(), driverViewCount: { increment: 1 } } })
    .catch(() => {})
  return NextResponse.json({ ok: true, ...(await buildDriverUnitView(row, todayPacific())) })
}
