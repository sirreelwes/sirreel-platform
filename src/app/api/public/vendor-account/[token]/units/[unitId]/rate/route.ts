/** POST /api/public/vendor-account/[token]/units/[unitId]/rate — the partner
 *  proposes new list rates on one of their units. Nothing changes until HQ
 *  accepts; see vendorAccountActions.proposeUnitRates. */
import { NextRequest, NextResponse } from 'next/server'
import { vendorByToken, proposeUnitRates } from '@/lib/sub-rentals/vendorAccountActions'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'
import { parseRateProposal } from '@/lib/sub-rentals/rateProposalInput'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { token: string; unitId: string } }) {
  if (!checkRateLimit(`vendor-account:${clientIp(req)}`).ok) return NextResponse.json({ error: 'Slow down.' }, { status: 429 })
  const v = await vendorByToken(params.token)
  if (!v) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const parsed = parseRateProposal(b && typeof b === 'object' ? b : {})
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  try {
    await proposeUnitRates(v.id, params.unitId, parsed.input)
    return NextResponse.json({ ok: true })
  } catch (e) {
    // Only our own thrown answers (they carry a status) reach the partner;
    // anything else is logged and stays on the server.
    const status = (e as { status?: number }).status
    if (status && status < 500) return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status })
    console.error('[vendor-account rate] failed:', e)
    return NextResponse.json({ error: 'That did not go through — please try again.' }, { status: 500 })
  }
}
