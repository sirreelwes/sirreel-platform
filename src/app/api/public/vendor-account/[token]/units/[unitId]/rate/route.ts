/** POST /api/public/vendor-account/[token]/units/[unitId]/rate — the partner
 *  proposes new list rates on one of their units. Nothing changes until HQ
 *  accepts; see vendorAccountActions.proposeUnitRates. */
import { NextRequest, NextResponse } from 'next/server'
import { vendorByToken, proposeUnitRates } from '@/lib/sub-rentals/vendorAccountActions'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { token: string; unitId: string } }) {
  if (!checkRateLimit(`vendor-account:${clientIp(req)}`).ok) return NextResponse.json({ error: 'Slow down.' }, { status: 429 })
  const v = await vendorByToken(params.token)
  if (!v) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const n = (k: string) => (b[k] === '' || b[k] == null ? null : Number(b[k]))
  try {
    await proposeUnitRates(v.id, params.unitId, { daily: n('daily'), weekly: n('weekly'), monthly: n('monthly'), note: typeof b.note === 'string' ? b.note : null })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: (e as { status?: number }).status ?? 500 })
  }
}
