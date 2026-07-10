import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'
import { startNewSubmit } from '@/lib/public/agreementEntry'

export const dynamic = 'force-dynamic'

/**
 * POST /api/public/agreement-start/[token] — the Branch C "new job" form
 * submit (client action = real intent). Creates Person/Company/Inquiry as
 * needed and mints Job + Order through the SAME WelcomeInvite click-to-create
 * path (startWelcomeInvite) — repeat submits / forwarded links resolve to the
 * SAME job. Returns the portal URL (agreement ready to sign) + the order-form
 * URL. Token-gated (the 256-bit token from the email IS the identity); rate
 * limited per IP like the other public intakes.
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const ip = clientIp(req)
  const rl = checkRateLimit(`agreement-start:${ip}`)
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: 'Too many requests — try again shortly.' }, { status: 429 })
  }

  const body = (await req.json().catch(() => null)) as {
    jobName?: unknown
    companyName?: unknown
    firstName?: unknown
    lastName?: unknown
    startDate?: unknown
    endDate?: unknown
    website?: unknown
  } | null
  if (!body) return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 })
  // Honeypot — silent fake success, nothing created.
  if (typeof body.website === 'string' && body.website.trim().length > 0) {
    return NextResponse.json({ ok: true, portalUrl: null, orderFormUrl: null })
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : '')

  const result = await startNewSubmit(params.token || '', {
    jobName: str(body.jobName),
    companyName: str(body.companyName),
    firstName: str(body.firstName),
    lastName: str(body.lastName),
    startDate: str(body.startDate) || null,
    endDate: str(body.endDate) || null,
  })
  if (result.kind === 'ok') {
    return NextResponse.json({ ok: true, portalUrl: result.portalUrl, orderFormUrl: result.orderFormUrl })
  }
  if (result.kind === 'error') {
    return NextResponse.json({ ok: false, error: result.message }, { status: 400 })
  }
  return NextResponse.json({ ok: false, error: 'This link is no longer valid — request a fresh one from the rental agreement page.' }, { status: 404 })
}
