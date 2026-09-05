/** POST /api/public/vendor-hq/[token]/clients — a production that books
 *  the partner directly. */
import { NextRequest, NextResponse } from 'next/server'
import { gateHq, readJson, hqErrorResponse } from '@/lib/hq-white-label/routeGate'
import { createClient } from '@/lib/hq-white-label/actions'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const g = await gateHq(req, params.token)
  if ('error' in g) return g.error
  try {
    return NextResponse.json(await createClient(g.ws, await readJson(req)), { status: 201 })
  } catch (e) {
    return hqErrorResponse(e)
  }
}
