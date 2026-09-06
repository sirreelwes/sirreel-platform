/** /api/public/utliiz-drive/[token]/hours — the driver's day, with meters.
 *  Same body and view as the SirReel driver routes; third anchor. */
import { NextRequest, NextResponse } from 'next/server'
import { bookingByDriverToken } from '@/lib/hq-white-label/driverFlow'
import { deleteHours, listHours, upsertHours } from '@/lib/drivers/hoursStore'

export const dynamic = 'force-dynamic'

async function resolve(token: string) {
  const b = await bookingByDriverToken(token)
  if (!b) return { error: NextResponse.json({ error: 'invalid link' }, { status: 404 }) }
  if (b.status === 'CANCELLED') return { error: NextResponse.json({ error: 'This booking was cancelled.' }, { status: 409 }) }
  return { b, window: { startDate: b.startDate.toISOString().slice(0, 10), endDate: b.endDate.toISOString().slice(0, 10) } }
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const r = await resolve(params.token)
  if ('error' in r) return r.error
  return NextResponse.json({ ok: true, hours: await listHours({ workspaceBookingId: r.b.id }), window: r.window })
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const r = await resolve(params.token)
  if ('error' in r) return r.error
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const res = await upsertHours({ workspaceBookingId: r.b.id }, body, r.window)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true, hours: res.view })
}

export async function DELETE(req: NextRequest, { params }: { params: { token: string } }) {
  const r = await resolve(params.token)
  if ('error' in r) return r.error
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const view = await deleteHours({ workspaceBookingId: r.b.id }, body.workDate)
  if (!view) return NextResponse.json({ error: 'workDate required' }, { status: 400 })
  return NextResponse.json({ ok: true, hours: view })
}
