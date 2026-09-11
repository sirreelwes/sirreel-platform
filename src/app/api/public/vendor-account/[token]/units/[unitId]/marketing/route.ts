/** POST /api/public/vendor-account/[token]/units/[unitId]/marketing — the
 *  partner allows or withdraws SirReel's permission to offer this unit to
 *  clients. Body { allowed: boolean }. Agreement clause 10: theirs to revoke
 *  at any time. */
import { NextRequest, NextResponse } from 'next/server'
import { vendorByToken, setUnitMarketing } from '@/lib/sub-rentals/vendorAccountActions'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { token: string; unitId: string } }) {
  if (!checkRateLimit(`vendor-account:${clientIp(req)}`).ok) return NextResponse.json({ error: 'Slow down.' }, { status: 429 })
  const v = await vendorByToken(params.token)
  if (!v) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  if (typeof b.allowed !== 'boolean') return NextResponse.json({ error: 'allowed must be true or false' }, { status: 400 })
  try {
    await setUnitMarketing(v.id, params.unitId, b.allowed)
    return NextResponse.json({ ok: true, allowed: b.allowed })
  } catch (e) {
    const status = (e as { status?: number }).status
    if (status && status < 500) return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status })
    console.error('[vendor-account marketing] failed:', e)
    return NextResponse.json({ error: 'That did not go through — please try again.' }, { status: 500 })
  }
}
