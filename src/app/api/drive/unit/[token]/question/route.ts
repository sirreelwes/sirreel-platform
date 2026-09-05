/**
 * POST /api/drive/unit/[token]/question — the driver asks the production
 * something, through us. The production's reply rides the relay address
 * back to the driver, so neither ever holds the other's address.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { subRentalForDriverToken } from '@/lib/sub-rentals/driverUnitView'
import { relayDriverQuestion } from '@/lib/sub-rentals/conduit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const row = await subRentalForDriverToken(params.token)
  if (!row) return NextResponse.json({ error: 'invalid link' }, { status: 404 })
  if (row.status === 'CANCELLED' || row.status === 'RETURNED') {
    return NextResponse.json({ error: 'This job is closed.' }, { status: 409 })
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (text.length < 3) return NextResponse.json({ error: 'Type your question first.' }, { status: 400 })
  if (text.length > 2000) return NextResponse.json({ error: 'Keep it under 2000 characters.' }, { status: 400 })

  const sent = await relayDriverQuestion(row.id, text).catch((err) => {
    console.warn('[drive/unit/question] relay failed:', err instanceof Error ? err.message : err)
    return { productionMailed: 0 }
  })
  await prisma.auditLog.create({
    data: {
      action: 'sub_rental.driver_question',
      entityType: 'SubRental',
      entityId: row.id,
      newValues: { driverName: row.driverName, text, productionMailed: sent.productionMailed, via: 'driver-page' },
    },
  })
  if (!sent.productionMailed) {
    return NextResponse.json({ error: 'We couldn’t reach the production just now. Call SirReel on (888) 477-7335.' }, { status: 502 })
  }
  return NextResponse.json({ ok: true })
}
