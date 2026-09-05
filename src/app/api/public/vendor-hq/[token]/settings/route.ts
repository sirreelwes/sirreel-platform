/** PATCH /api/public/vendor-hq/[token]/settings — brand name and accent. */
import { NextRequest, NextResponse } from 'next/server'
import { gateHq, readJson, hqErrorResponse } from '@/lib/hq-white-label/routeGate'
import { updateSettings } from '@/lib/hq-white-label/actions'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { token: string } }) {
  const g = await gateHq(req, params.token)
  if ('error' in g) return g.error
  try {
    await updateSettings(g.ws, await readJson(req))
    return NextResponse.json({ ok: true })
  } catch (e) {
    return hqErrorResponse(e)
  }
}
