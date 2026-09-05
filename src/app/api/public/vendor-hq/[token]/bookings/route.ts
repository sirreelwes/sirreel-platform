/** POST /api/public/vendor-hq/[token]/bookings — the partner books one of
 *  their own units. Answers { conflicts } (409) when the unit is already
 *  spoken for, unless allowOverlap is set. */
import { NextRequest, NextResponse } from 'next/server'
import { gateHq, readJson, hqErrorResponse } from '@/lib/hq-white-label/routeGate'
import { createBooking } from '@/lib/hq-white-label/actions'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const g = await gateHq(req, params.token)
  if ('error' in g) return g.error
  try {
    const r = await createBooking(g.ws, await readJson(req))
    if ('conflicts' in r) return NextResponse.json(r, { status: 409 })
    return NextResponse.json(r, { status: 201 })
  } catch (e) {
    return hqErrorResponse(e)
  }
}
