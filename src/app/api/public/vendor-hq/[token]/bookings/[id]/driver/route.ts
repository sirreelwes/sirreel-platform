/** POST /api/public/vendor-hq/[token]/bookings/[id]/driver { vendorDriverId | null } */
import { NextRequest, NextResponse } from 'next/server'
import { gateHq, readJson, hqErrorResponse } from '@/lib/hq-white-label/routeGate'
import { assignBookingDriver } from '@/lib/hq-white-label/driverFlow'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { token: string; id: string } }) {
  const g = await gateHq(req, params.token)
  if ('error' in g) return g.error
  try {
    const b = await readJson(req)
    const id = typeof b.vendorDriverId === 'string' && b.vendorDriverId ? b.vendorDriverId : null
    return NextResponse.json({ ok: true, ...(await assignBookingDriver({ id: g.ws.id, vendorId: g.ws.vendorId }, params.id, id)) })
  } catch (e) {
    return hqErrorResponse(e)
  }
}
