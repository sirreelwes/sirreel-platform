/** POST /api/public/vendor-account/[token]/share — the partner counter-offers
 *  on the split itself. Nothing changes until HQ accepts; see
 *  vendorAccountActions.proposeShare. The body carries THEIR percentage, not
 *  SirReel's — the conversion happens once, in the action. */
import { NextRequest, NextResponse } from 'next/server'
import { vendorByToken, proposeShare } from '@/lib/sub-rentals/vendorAccountActions'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  if (!checkRateLimit(`vendor-account:${clientIp(req)}`).ok) return NextResponse.json({ error: 'Slow down.' }, { status: 429 })
  const v = await vendorByToken(params.token)
  if (!v) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const partnerPercent = b.partnerPercent === '' || b.partnerPercent == null ? null : Number(b.partnerPercent)
  try {
    await proposeShare(v.id, { partnerPercent, note: typeof b.note === 'string' ? b.note : null })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: (e as { status?: number }).status ?? 500 })
  }
}
