/**
 * /api/public/vendor-account/[token]/contacts — the partner keeps their own
 * list of people: owner, accounting, dispatch, whoever else.
 *
 *   GET  → their list
 *   POST → add one
 *
 * Token-gated like the rest of their page; HQ is told when they change it
 * (vendorAccountActions), the same way a contact-details edit is announced.
 */
import { NextRequest, NextResponse } from 'next/server'
import { partnerAddContact, partnerListContacts, vendorByToken } from '@/lib/sub-rentals/vendorAccountActions'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'

export const dynamic = 'force-dynamic'

/** A partner filling in their people types several in a row — the default
 *  public policy is sized for one-off posts, not a list. */
const CONTACTS_RATE = { max: 40, windowMs: 10 * 60 * 1000 }

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  if (!checkRateLimit(`vendor-contacts:${clientIp(req)}`, CONTACTS_RATE).ok) return NextResponse.json({ error: 'Slow down.' }, { status: 429 })
  const v = await vendorByToken(params.token)
  if (!v) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, contacts: await partnerListContacts(v.id) })
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  if (!checkRateLimit(`vendor-contacts:${clientIp(req)}`, CONTACTS_RATE).ok) return NextResponse.json({ error: 'Slow down.' }, { status: 429 })
  const v = await vendorByToken(params.token)
  if (!v) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const r = await partnerAddContact(v.id, v.name, body, body.code)
  if (!r.ok) {
    // 428: the change is fine, it just needs the code we email to the address
    // already on file (partnerActionCode.ts).
    const needsCode = 'needsCode' in r && r.needsCode === true
    return NextResponse.json({ ok: false, error: r.error, needsCode }, { status: needsCode ? 428 : 400 })
  }
  return NextResponse.json({ ok: true, contact: r.contact }, { status: 201 })
}
