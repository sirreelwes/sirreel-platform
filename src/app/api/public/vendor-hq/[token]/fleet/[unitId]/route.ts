/** PATCH /api/public/vendor-hq/[token]/fleet/[unitId] */
import { NextRequest, NextResponse } from 'next/server'
import { gateHq, readJson, hqErrorResponse } from '@/lib/hq-white-label/routeGate'
import { updateUnit } from '@/lib/hq-white-label/actions'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { token: string; unitId: string } }) {
  const g = await gateHq(req, params.token)
  if ('error' in g) return g.error
  try {
    await updateUnit(g.ws, params.unitId, await readJson(req))
    return NextResponse.json({ ok: true })
  } catch (e) {
    return hqErrorResponse(e)
  }
}
