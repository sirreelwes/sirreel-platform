/**
 * GET /api/portal/job/payment-details — SirReel's bank details, shown to an
 * authenticated client inside their portal.
 *
 * WHY THIS EXISTS (it reverses an earlier ruling)
 *
 * lib/payments/paymentDetails previously carried the invariant "NEVER
 * rendered on any public/browser surface; delivered by email only". That was
 * the right call while the only alternative was an unauthenticated page. It
 * is the wrong call against an authenticated portal, because it misreads the
 * threat.
 *
 * These details are not confidential — they are printed on every check a
 * client mails and sit in the accounts-payable file of everyone SirReel has
 * ever invoiced. The real risk is SUBSTITUTION: invoice-redirect fraud, where
 * an attacker inside an email thread swaps the routing number and the client
 * pays them in good faith. Nobody notices until the money never arrives, and
 * the client reasonably considers themselves paid.
 *
 * Email cannot defend against that — the recipient has no way to tell an
 * altered copy from a real one. A page served from sirreel.com over TLS can:
 * the numbers come from our database at read time and no intermediary can
 * rewrite them.
 *
 * So: authentication here is about knowing who is asking, not about secrecy.
 * It reuses the same signed session cookie that guards the portal's payment
 * routes, so this surface is no broader than the ability to pay an invoice.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  JOB_SESSION_COOKIE,
  verifyJobSessionCookieValue,
  buildJobSessionCookieHeader,
} from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { loadClientPaymentDetails } from '@/lib/payments/paymentDetails'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) return NextResponse.json({ error: 'No session' }, { status: 401 })

  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) {
    const res = NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })
    res.headers.append('Set-Cookie', buildJobSessionCookieHeader('', { clear: true }))
    return res
  }

  // Shape + the "configured" rule live in the shared loader, so this route
  // and the v2 paperwork portal's cannot drift apart.
  const payload = await loadClientPaymentDetails()
  return NextResponse.json({ ok: true, ...payload })
}
