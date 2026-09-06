/** POST /api/public/utliiz/request — the form on utliiz.com. Public,
 *  rate-limited, lands a UtliizLead and mails VerMar ops. */
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'
import { createLead } from '@/lib/hq-white-label/leads'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  if (!checkRateLimit(`utliiz-request:${ip}`).ok) return NextResponse.json({ error: 'Slow down — try again in a few minutes.' }, { status: 429 })
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!b || typeof b !== 'object') return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  // Honeypot: real people never fill a field they can't see.
  if (typeof b.website === 'string' && b.website.trim()) return NextResponse.json({ ok: true })
  try {
    return NextResponse.json({ ok: true, ...(await createLead(b, ip)) }, { status: 201 })
  } catch (e) {
    const status = typeof (e as { status?: number })?.status === 'number' ? (e as { status: number }).status : 500
    if (status >= 500) console.error('[utliiz request]', e)
    return NextResponse.json({ error: status < 500 && e instanceof Error ? e.message : 'Something went wrong.' }, { status })
  }
}
