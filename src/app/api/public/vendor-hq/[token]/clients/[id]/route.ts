/** PATCH /api/public/vendor-hq/[token]/clients/[id] */
import { NextRequest, NextResponse } from 'next/server'
import { gateHq, readJson, hqErrorResponse } from '@/lib/hq-white-label/routeGate'
import { updateClient } from '@/lib/hq-white-label/actions'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { token: string; id: string } }) {
  const g = await gateHq(req, params.token)
  if ('error' in g) return g.error
  try {
    await updateClient(g.ws, params.id, await readJson(req))
    return NextResponse.json({ ok: true })
  } catch (e) {
    return hqErrorResponse(e)
  }
}
