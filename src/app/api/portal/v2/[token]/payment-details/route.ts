/**
 * GET /api/portal/v2/[token]/payment-details — the ways to pay that aren't a
 * card, inside the guided paperwork portal.
 *
 * WHY IT LIVES HERE TOO
 *
 * The card-authorization email tells a client that if they'd rather pay
 * another way, the details are in their portal. Its button opens THIS portal
 * — and this was the one client surface that didn't have them. The job portal
 * (/portal/job/[slug]) has carried them since the ruling in
 * lib/payments/paymentDetails, but a client whose first touch is a card
 * request holds no job-portal link, so "it's in your portal" sent them
 * somewhere they couldn't reach.
 *
 * AUTH
 *
 * By the PaperworkRequest token in the URL, not a session cookie — the same
 * credential every other route on this portal uses, and the same one the
 * portal already collects a CREDIT CARD behind. A token good enough to take a
 * client's card is good enough to show them numbers that are printed on every
 * check they mail. What it is NOT is anonymous, which is the property that
 * matters: an unauthenticated page is one an attacker can clone and point a
 * victim at.
 *
 * Read-only. Writes nothing, mints nothing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { loadClientPaymentDetails } from '@/lib/payments/paymentDetails'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const request = await prisma.paperworkRequest.findUnique({
    where: { token: params.token },
    select: { id: true },
  })
  if (!request) {
    return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })
  }

  const payload = await loadClientPaymentDetails()
  return NextResponse.json({ ok: true, ...payload })
}
