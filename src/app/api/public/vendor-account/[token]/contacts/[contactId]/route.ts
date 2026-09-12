/**
 * /api/public/vendor-account/[token]/contacts/[contactId] — the partner edits
 * or removes one of their own people. Token-gated; HQ is told.
 */
import { NextRequest, NextResponse } from 'next/server'
import { partnerRemoveContact, partnerUpdateContact, vendorByToken } from '@/lib/sub-rentals/vendorAccountActions'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'

export const dynamic = 'force-dynamic'

const CONTACTS_RATE = { max: 40, windowMs: 10 * 60 * 1000 }

export async function PATCH(req: NextRequest, { params }: { params: { token: string; contactId: string } }) {
  if (!checkRateLimit(`vendor-contacts:${clientIp(req)}`, CONTACTS_RATE).ok) return NextResponse.json({ error: 'Slow down.' }, { status: 429 })
  const v = await vendorByToken(params.token)
  if (!v) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const r = await partnerUpdateContact(v.id, v.name, params.contactId, body, body.code)
  if (!r.ok) {
    const needsCode = 'needsCode' in r && r.needsCode === true
    return NextResponse.json({ ok: false, error: r.error, needsCode }, { status: needsCode ? 428 : 400 })
  }
  return NextResponse.json({ ok: true, contact: r.contact })
}

export async function DELETE(req: NextRequest, { params }: { params: { token: string; contactId: string } }) {
  if (!checkRateLimit(`vendor-contacts:${clientIp(req)}`, CONTACTS_RATE).ok) return NextResponse.json({ error: 'Slow down.' }, { status: 429 })
  const v = await vendorByToken(params.token)
  if (!v) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const r = await partnerRemoveContact(v.id, v.name, params.contactId)
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
