/**
 * POST /api/orders/[id]/send-payment-options — email this order's client
 * SirReel's payment details.
 *
 * Wes, 2026-09-01, after Dreambear could not pay: "add that button to the
 * HQ order invoice." Collections has had a Send options action for years,
 * but it hangs off a FinalInvoice row in the collections queue. An HQ
 * invoice on an order has no such row, so the only way to give a client
 * bank details was to talk them through the portal.
 *
 * Reuses sendPaymentDetailsEmail verbatim — the same branded body, the
 * same fraud line, the same private-Blob attachments, and the same minted
 * verification anchor the /payment-info flow uses. A second template
 * would be a second set of bank numbers to keep correct, which is exactly
 * the failure the anchor exists to protect against.
 *
 * Recipient is the order's own contact — never a typed address. The
 * details go to whoever is already on the paperwork.
 *
 * Auth: any authenticated staff session, matching the sibling operator
 * send. The operator IS the identity gate (Wes's fast-send ruling).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { sendPaymentDetailsEmail } from '@/lib/payments/sendPaymentDetails'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      orderNumber: true,
      jobContact: { select: { firstName: true, lastName: true, email: true } },
      job: {
        select: {
          jobContacts: {
            select: {
              isPrimary: true,
              role: true,
              person: { select: { firstName: true, lastName: true, email: true } },
            },
          },
        },
      },
    },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // Who gets it: the order's own contact, else the job's — ACCOUNTING
  // first, since payment details are their business, then the primary.
  // An address that cannot receive mail is not a recipient.
  const valid = (e?: string | null) => !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
  const jc = order.job?.jobContacts ?? []
  const candidate =
    (valid(order.jobContact?.email) ? order.jobContact : null) ??
    jc.find((c) => c.role === 'ACCOUNTING' && valid(c.person.email))?.person ??
    jc.find((c) => c.isPrimary && valid(c.person.email))?.person ??
    jc.find((c) => valid(c.person.email))?.person ??
    null

  if (!candidate || !valid(candidate.email)) {
    return NextResponse.json(
      { error: 'No contact with a valid email on this order. Add one first.' },
      { status: 409 },
    )
  }

  const result = await sendPaymentDetailsEmail({
    to: candidate.email as string,
    firstName: candidate.firstName ?? null,
  })
  if (!result.ok) {
    // 'not_configured' means the bank details have never been filled in —
    // an operator problem with a specific fix, not a generic failure.
    return NextResponse.json(
      {
        error:
          result.reason === 'not_configured'
            ? 'Payment details are not set up yet — fill them in under Admin → Payment Info.'
            : 'Could not send the payment details. Please try again.',
      },
      { status: result.reason === 'not_configured' ? 409 : 502 },
    )
  }

  return NextResponse.json({
    ok: true,
    sentTo: candidate.email,
    name: [candidate.firstName, candidate.lastName].filter(Boolean).join(' ').trim() || null,
  })
}
