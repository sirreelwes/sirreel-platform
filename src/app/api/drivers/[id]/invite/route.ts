import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendTracked } from '@/lib/sms/threads'
import { toE164 } from '@/lib/sms/sendSms'

export const dynamic = 'force-dynamic'

// Driver portal links are short-lived on purpose: the page they open
// accepts a licence upload with no login, so a leaked link should stop
// working quickly. 14 days covers "production books Tuesday, driver
// uploads over the weekend" without leaving links live for months.
const LINK_TTL_DAYS = 14

/**
 * POST /api/drivers/[id]/invite — mint (or re-mint) this driver's portal
 * token and return the link. Minting REPLACES any previous token, so
 * re-sending a link silently revokes the old one.
 *
 * The response is the only place the full link exists — it is not stored
 * anywhere a later GET can read it back, same posture as order portal
 * access.
 *
 * `{ channel: 'SMS' }` also TEXTS it to the driver's number (Wes
 * 2026-09-15) — the rep at the gate has the driver in front of them and
 * their phone in their hand, and reading a uuid aloud is not a process.
 * The link still comes back either way, so Copy keeps working.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const { id } = await params
  const body = await req.json().catch(() => null)
  const wantsSms = body?.channel === 'SMS'
  const driver = await prisma.driver.findUnique({
    where: { id },
    select: { id: true, firstName: true, phone: true },
  })
  if (!driver) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const phone = wantsSms ? toE164(driver.phone || '') : null
  if (wantsSms && !phone) {
    return NextResponse.json(
      { error: 'That driver has no mobile number on file — add one first.' },
      { status: 400 },
    )
  }

  const token = randomUUID()
  const now = new Date()
  const expires = new Date(now.getTime() + LINK_TTL_DAYS * 24 * 60 * 60 * 1000)
  await prisma.driver.update({
    where: { id },
    data: { portalToken: token, portalTokenAt: now, portalExpiresAt: expires },
  })
  const base = process.env.NEXT_PUBLIC_PORTAL_URL || 'https://tsx.sirreel.com'
  const url = `${base}/driver/${token}`

  if (wantsSms && phone) {
    const hi = driver.firstName?.trim() ? `${driver.firstName.trim()}, ` : ''
    // No codes, no job details — this link is the licence upload and the
    // driver's own details. sendTracked adds the STOP line.
    const sms = await sendTracked({
      to: phone,
      body: `SirReel: ${hi}add your driver's license and details here before pickup: ${url}`,
      source: 'staff',
    })
    return NextResponse.json({
      ok: true, url, expiresAt: expires,
      smsSent: sms.ok, smsStatus: sms.status, smsError: sms.error ?? null, smsTo: phone,
    })
  }

  return NextResponse.json({ ok: true, url, expiresAt: expires })
}
