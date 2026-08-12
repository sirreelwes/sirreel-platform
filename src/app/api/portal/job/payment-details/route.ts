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

export const dynamic = 'force-dynamic'

const SINGLETON = 'singleton'

export async function GET(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) return NextResponse.json({ error: 'No session' }, { status: 401 })

  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) {
    const res = NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })
    res.headers.append('Set-Cookie', buildJobSessionCookieHeader('', { clear: true }))
    return res
  }

  const s = await prisma.siteSetting.findUnique({
    where: { id: SINGLETON },
    select: {
      paymentPayeeName: true,
      paymentBankName: true,
      paymentAccountType: true,
      paymentAccountNumber: true,
      paymentRoutingAch: true,
      paymentRoutingWire: true,
      paymentRemittanceEmail: true,
      paymentBankAddress: true,
      paymentInstructions: true,
      paymentZelleHandle: true,
      paymentZelleName: true,
    },
  })

  // Configured = we have a payee, an account number and an ACH routing
  // number. Rendering a half-filled panel would invite a client to wire money
  // against incomplete instructions, which is worse than showing nothing.
  const configured = !!(
    s?.paymentPayeeName &&
    s?.paymentAccountNumber &&
    s?.paymentRoutingAch
  )
  if (!configured) return NextResponse.json({ ok: true, configured: false })

  return NextResponse.json({
    ok: true,
    configured: true,
    details: {
      payeeName: s!.paymentPayeeName,
      bankName: s!.paymentBankName ?? null,
      accountType: s!.paymentAccountType ?? null,
      accountNumber: s!.paymentAccountNumber,
      routingAch: s!.paymentRoutingAch,
      routingWire: s!.paymentRoutingWire ?? null,
      remittanceEmail: s!.paymentRemittanceEmail ?? null,
      bankAddress: s!.paymentBankAddress ?? null,
      instructions: s!.paymentInstructions ?? null,
      zelleHandle: s!.paymentZelleHandle ?? null,
      zelleName: s!.paymentZelleName ?? null,
    },
  })
}
