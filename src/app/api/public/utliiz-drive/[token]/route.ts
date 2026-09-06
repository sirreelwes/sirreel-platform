/** GET /api/public/utliiz-drive/[token] — the driver's view of their booking. */
import { NextResponse } from 'next/server'
import { loadDriverBooking } from '@/lib/hq-white-label/driverFlow'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const v = await loadDriverBooking(params.token)
  if (!v) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, view: v })
}
