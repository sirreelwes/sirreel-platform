/**
 * /api/drive/unit/[token]/hours — the partner's driver logs a day.
 *   POST   { workDate, startTime, endTime, breakMinutes?, notes? }  (upsert per day)
 *   DELETE { workDate }
 */
import { NextRequest, NextResponse } from 'next/server'
import { subRentalForDriverToken } from '@/lib/sub-rentals/driverUnitView'
import { deleteHours, upsertHours } from '@/lib/drivers/hoursStore'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const row = await subRentalForDriverToken(params.token)
  if (!row) return NextResponse.json({ error: 'invalid link' }, { status: 404 })
  if (row.status === 'CANCELLED') return NextResponse.json({ error: 'This job was cancelled.' }, { status: 409 })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const res = await upsertHours({ subRentalId: row.id }, body, {
    startDate: row.startDate?.toISOString().slice(0, 10) ?? null,
    endDate: row.endDate?.toISOString().slice(0, 10) ?? null,
  })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true, hours: res.view })
}

export async function DELETE(req: NextRequest, { params }: { params: { token: string } }) {
  const row = await subRentalForDriverToken(params.token)
  if (!row) return NextResponse.json({ error: 'invalid link' }, { status: 404 })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const view = await deleteHours({ subRentalId: row.id }, body.workDate)
  if (!view) return NextResponse.json({ error: 'workDate required' }, { status: 400 })
  return NextResponse.json({ ok: true, hours: view })
}
