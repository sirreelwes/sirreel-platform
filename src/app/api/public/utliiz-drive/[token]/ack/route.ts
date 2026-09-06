/** POST /api/public/utliiz-drive/[token]/ack */
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'
import { bookingByDriverToken, loadDriverBooking, ackDriverBooking } from '@/lib/hq-white-label/driverFlow'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  if (!checkRateLimit(`utliiz-drive:${clientIp(req)}`, { windowMs: 60_000, max: 30 }).ok) return NextResponse.json({ error: 'Slow down.' }, { status: 429 })
  const b = await bookingByDriverToken(params.token)
  if (!b) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (b.status === 'CANCELLED') return NextResponse.json({ error: 'This booking was cancelled.' }, { status: 409 })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  try {
    await ackDriverBooking(b.id, body)
    return NextResponse.json({ ok: true, view: await loadDriverBooking(params.token) })
  } catch (e) {
    const status = typeof (e as { status?: number })?.status === 'number' ? (e as { status: number }).status : 500
    if (status >= 500) console.error('[utliiz-drive/ack]', e)
    return NextResponse.json({ error: status < 500 && e instanceof Error ? e.message : 'Something went wrong.' }, { status })
  }
}
