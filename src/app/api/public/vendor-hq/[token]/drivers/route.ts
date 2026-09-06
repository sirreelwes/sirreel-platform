/** GET/POST /api/public/vendor-hq/[token]/drivers — the partner's roster;
 *  POST { email, name? } adds one and emails them their profile page. */
import { NextRequest, NextResponse } from 'next/server'
import { gateHq, readJson, hqErrorResponse } from '@/lib/hq-white-label/routeGate'
import { addWorkspaceDriver, listWorkspaceDrivers } from '@/lib/hq-white-label/driverFlow'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const g = await gateHq(req, params.token)
  if ('error' in g) return g.error
  return NextResponse.json({ drivers: await listWorkspaceDrivers(g.ws.vendorId) })
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const g = await gateHq(req, params.token)
  if ('error' in g) return g.error
  try {
    const b = await readJson(req)
    return NextResponse.json(await addWorkspaceDriver({ id: g.ws.id, vendorId: g.ws.vendorId, brandName: g.ws.brandName }, { email: b.email, name: b.name }), { status: 201 })
  } catch (e) {
    return hqErrorResponse(e)
  }
}
