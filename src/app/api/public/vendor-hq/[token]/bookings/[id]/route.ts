/** PATCH /api/public/vendor-hq/[token]/bookings/[id] — edit or move a
 *  booking through its lifecycle. */
import { NextRequest, NextResponse } from 'next/server'
import { gateHq, readJson, hqErrorResponse } from '@/lib/hq-white-label/routeGate'
import { updateBooking } from '@/lib/hq-white-label/actions'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { token: string; id: string } }) {
  const g = await gateHq(req, params.token)
  if ('error' in g) return g.error
  try {
    const r = await updateBooking(g.ws, params.id, await readJson(req))
    if ('conflicts' in r) return NextResponse.json(r, { status: 409 })
    return NextResponse.json(r)
  } catch (e) {
    return hqErrorResponse(e)
  }
}
