/**
 * POST /api/public/vendor-account/[token]/contacts/code — email the partner a
 * short code, at the address already on file, for a change that would move
 * where their mail goes.
 *
 * Wes 2026-09-11, on the account link being forwardable: "Is this a danger, a
 * loop we should close?" This is the close. Holding the link is not enough to
 * point SirReel's mail somewhere new — you also have to be able to read the
 * inbox we already write to.
 */
import { NextRequest, NextResponse } from 'next/server'
import { sendPartnerActionCode, vendorByToken } from '@/lib/sub-rentals/vendorAccountActions'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'

export const dynamic = 'force-dynamic'

/** Codes go to one fixed address, so this only needs to stop a flood. */
const CODE_RATE = { max: 6, windowMs: 10 * 60 * 1000 }

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  if (!checkRateLimit(`vendor-action-code:${clientIp(req)}`, CODE_RATE).ok) {
    return NextResponse.json({ error: 'That is a lot of codes — give it a minute.' }, { status: 429 })
  }
  const v = await vendorByToken(params.token)
  if (!v) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const r = await sendPartnerActionCode(v.id)
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, sentTo: r.sentTo })
}
