/** PATCH /api/public/vendor-account/[token]/contact — the partner edits
 *  their own contact details. Token-gated; HQ is told. */
import { NextRequest, NextResponse } from 'next/server'
import { vendorByToken, updateVendorContact } from '@/lib/sub-rentals/vendorAccountActions'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { token: string } }) {
  if (!checkRateLimit(`vendor-account:${clientIp(req)}`).ok) return NextResponse.json({ error: 'Slow down.' }, { status: 429 })
  const v = await vendorByToken(params.token)
  if (!v) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : b[k] === null ? null : undefined)
  await updateVendorContact(v.id, { contactName: str('contactName'), email: str('email'), phone: str('phone'), lotAddress: str('lotAddress') })
  return NextResponse.json({ ok: true })
}
