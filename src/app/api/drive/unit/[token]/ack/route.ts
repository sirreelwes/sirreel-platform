/**
 * POST /api/drive/unit/[token]/ack — "I have the location and call time."
 * Stamps the confirmation and tells the production (Wes: "when the driver
 * confirms location and calltime receipt, the client will get an email").
 * Pressing it again after a change re-confirms the new version.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { subRentalForDriverToken, buildDriverUnitView, todayPacific } from '@/lib/sub-rentals/driverUnitView'
import { logisticsFor, notifyDriverAcked } from '@/lib/sub-rentals/conduit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const row = await subRentalForDriverToken(params.token)
  if (!row) return NextResponse.json({ error: 'invalid link' }, { status: 404 })
  if (row.status === 'CANCELLED' || row.status === 'RETURNED') {
    return NextResponse.json({ error: 'This job is closed.' }, { status: 409 })
  }
  if (!logisticsFor(row).hasAny) {
    return NextResponse.json({ error: 'There is nothing to confirm yet — the production hasn’t sent the details.' }, { status: 409 })
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) || null : null

  await prisma.subRental.update({
    where: { id: row.id },
    data: { driverAckedAt: new Date(), driverAckNote: note },
  })
  await prisma.auditLog.create({
    data: {
      action: 'sub_rental.driver_acked',
      entityType: 'SubRental',
      entityId: row.id,
      newValues: { driverName: row.driverName, note, via: 'driver-page' },
    },
  })
  const sent = await notifyDriverAcked(row.id).catch((err) => {
    console.warn('[drive/unit/ack] notify failed:', err instanceof Error ? err.message : err)
    return { productionMailed: 0 }
  })
  const fresh = await subRentalForDriverToken(params.token)
  return NextResponse.json({ ok: true, productionMailed: sent.productionMailed, ...(fresh ? await buildDriverUnitView(fresh, todayPacific()) : {}) })
}
