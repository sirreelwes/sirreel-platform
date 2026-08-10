import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCollectionsUser } from '@/lib/collections/access'
import { chargeCard, isApproved, cardDisplayFromToken } from '@/lib/cardpointe/client'
import { surchargeBreakdown } from '@/lib/payments/surcharge'

export const dynamic = 'force-dynamic'

/**
 * POST /api/collections/charge — take a card payment against a RentalWorks
 * invoice, for money collected before billing moves into HQ.
 *
 * Two token sources, both ending in the same charge:
 *   savedPaperworkId → the CardSecure token captured by the portal
 *                      CC-authorization step. Nothing is re-keyed.
 *   cardToken        → minted client-side by the CardSecure iframe when an
 *                      operator takes a card over the phone.
 *
 * The raw PAN never reaches this server on either path. `cardToken` is
 * already a CardSecure token when it arrives — the iframe posts to
 * CardConnect, not to us.
 *
 * SURCHARGE: the 3% fee is computed HERE from the base amount, never trusted
 * from the client. `amount` credits the invoice; the gateway is charged
 * amount + surcharge, matching how Payment splits the two.
 *
 * MOTO: phone-keyed charges send ecomind 'T'. A saved authorization the
 * client signed in the portal is not MOTO — that one keeps 'E'.
 *
 * DECLINES ARE RECORDED. A failed collections call is information; dropping
 * it would make the history lie about how often cards bounce.
 */

const MAX_AMOUNT = 250_000

export async function POST(req: NextRequest) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })

  const body = (await req.json().catch(() => null)) as {
    rwInvoiceId?: unknown
    finalInvoiceId?: unknown
    invoiceNumber?: unknown
    customerName?: unknown
    amount?: unknown
    cardToken?: unknown
    expiry?: unknown
    savedPaperworkId?: unknown
    cardholderName?: unknown
    pdfUrl?: unknown
    pdfKey?: unknown
    note?: unknown
  } | null
  if (!body) return NextResponse.json({ ok: false, error: 'body required' }, { status: 400 })

  const finalInvoiceId =
    typeof body.finalInvoiceId === 'string' ? body.finalInvoiceId.trim() : ''

  // A charge is anchored to EITHER a finalized invoice (the normal path — an
  // agent agreed the number and queued it) or a raw RW invoice id (the older
  // path, still needed for anything finalized outside HQ).
  let rwInvoiceId = typeof body.rwInvoiceId === 'string' ? body.rwInvoiceId.trim() : ''
  if (finalInvoiceId) {
    const fi = await prisma.jobFinalInvoice.findUnique({
      where: { id: finalInvoiceId },
      select: { id: true, rwInvoiceId: true, invoiceNumber: true, status: true },
    })
    if (!fi) {
      return NextResponse.json({ ok: false, error: 'final invoice not found' }, { status: 404 })
    }
    if (fi.status !== 'READY') {
      return NextResponse.json(
        { ok: false, error: `that invoice is already ${fi.status.toLowerCase()}` },
        { status: 409 },
      )
    }
    // Fall back to the final-invoice id itself so the charge is always
    // anchored to something, even when no RW invoice was linked.
    rwInvoiceId = fi.rwInvoiceId || rwInvoiceId || `final:${fi.id}`
  }
  if (!rwInvoiceId) {
    return NextResponse.json(
      { ok: false, error: 'rwInvoiceId or finalInvoiceId required' },
      { status: 400 },
    )
  }

  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    return NextResponse.json({ ok: false, error: 'invalid amount' }, { status: 400 })
  }

  // Resolve the token. A saved authorization is server-side only — the
  // browser sends an id, never a token, so a stored card can't be lifted
  // out of a response and replayed.
  let cardToken: string | null = null
  let cardLast4: string | null = null
  let cardType: string | null = null
  let cardholderName =
    typeof body.cardholderName === 'string' ? body.cardholderName.trim().slice(0, 120) : null
  let moto = true
  let cardExpiry = ''

  if (typeof body.savedPaperworkId === 'string' && body.savedPaperworkId.trim()) {
    const pw = await prisma.paperworkRequest.findUnique({
      where: { id: body.savedPaperworkId.trim() },
      select: {
        ccCardNumberEncrypted: true,
        ccCardLast4: true,
        ccCardType: true,
        ccCardholderFirst: true,
        ccCardholderLast: true,
      },
    })
    if (!pw?.ccCardNumberEncrypted) {
      return NextResponse.json(
        { ok: false, error: 'that authorization has no stored card' },
        { status: 400 },
      )
    }
    cardToken = pw.ccCardNumberEncrypted
    cardLast4 = pw.ccCardLast4
    cardType = pw.ccCardType
    cardholderName =
      cardholderName ||
      [pw.ccCardholderFirst, pw.ccCardholderLast].filter(Boolean).join(' ') ||
      null
    // The client signed this authorization themselves in the portal, so it is
    // not a mail/telephone order.
    moto = false
  } else if (typeof body.cardToken === 'string' && body.cardToken.trim()) {
    cardToken = body.cardToken.trim()
    // MMYY from the CardSecure iframe. Required for a card auth — reject here
    // with a clear message rather than letting the gateway return an opaque
    // decline that reads like the client's card was refused.
    cardExpiry = typeof body.expiry === 'string' ? body.expiry.replace(/\D/g, '').slice(0, 4) : ''
    if (cardExpiry.length !== 4) {
      return NextResponse.json(
        { ok: false, error: 'Card expiry is required (MMYY).' },
        { status: 400 },
      )
    }
  }

  if (!cardToken) {
    return NextResponse.json(
      { ok: false, error: 'either savedPaperworkId or cardToken is required' },
      { status: 400 },
    )
  }

  // Keyed charges carried neither card type nor last-4, so a disputed payment
  // had nothing identifying it. Recover both from the token; a saved
  // authorization already has them stored, so don't overwrite those.
  if (!cardLast4 || !cardType) {
    const d = cardDisplayFromToken(cardToken)
    cardLast4 = cardLast4 ?? d.last4
    cardType = cardType ?? d.cardType
  }

  const invoiceNumber =
    typeof body.invoiceNumber === 'string' ? body.invoiceNumber.trim().slice(0, 60) : ''
  const customerName =
    typeof body.customerName === 'string' ? body.customerName.trim().slice(0, 200) : null

  const { base, surcharge, total } = surchargeBreakdown(amount)

  let resp: Awaited<ReturnType<typeof chargeCard>>
  try {
    resp = await chargeCard({
      cardToken,
      // The gateway is charged base + surcharge; `base` is what credits the
      // invoice. Sending `base` here would silently eat the 3%.
      amountDollars: total,
      invoiceNumber: invoiceNumber || rwInvoiceId,
      cardholderName: cardholderName ?? undefined,
      expiry: cardExpiry || undefined,
      moto,
      // A saved authorization charged after the fact is merchant-initiated —
      // the cardholder isn't present. A freshly keyed card is a plain sale.
      storedCredential: moto === false ? 'merchant' : undefined,
    })
  } catch (err) {
    console.error('[collections] gateway threw:', err)
    await prisma.rwCollectionCharge.create({
      data: {
        rwInvoiceId,
        invoiceNumber: invoiceNumber || null,
        customerName,
        amount: base,
        surchargeAmount: surcharge,
        cardLast4,
        cardType,
        cardholderName,
        status: 'ERROR',
        respText: err instanceof Error ? err.message.slice(0, 300) : 'gateway error',
        pdfUrl: typeof body.pdfUrl === 'string' ? body.pdfUrl : null,
        pdfKey: typeof body.pdfKey === 'string' ? body.pdfKey : null,
        note: typeof body.note === 'string' ? body.note.slice(0, 1000) : null,
        chargedById: user.id,
      },
    })
    return NextResponse.json(
      { ok: false, error: 'Payment gateway unreachable — nothing was charged.' },
      { status: 502 },
    )
  }

  // Use the shared helper, not a bare respcode check: CardConnect returned
  // resptext 'Approval' with a respcode that isn't '00', and treating that
  // as a decline charges the card without crediting the invoice.
  const approved = isApproved(resp)

  const charge = await prisma.rwCollectionCharge.create({
    data: {
      rwInvoiceId,
      invoiceNumber: invoiceNumber || null,
      customerName,
      amount: base,
      surchargeAmount: surcharge,
      cardLast4,
      cardType,
      cardholderName,
      authCode: resp.authcode ?? null,
      retref: resp.retref ?? null,
      respText: resp.resptext?.slice(0, 300) ?? null,
      // Raw verdict fields — approval classification depends on these, so
      // record what the gateway actually said, not just our reading of it.
      respCode: resp.respcode ?? null,
      respStat: resp.respstat ?? null,
      status: approved ? 'APPROVED' : 'DECLINED',
      pdfUrl: typeof body.pdfUrl === 'string' ? body.pdfUrl : null,
      pdfKey: typeof body.pdfKey === 'string' ? body.pdfKey : null,
      note: typeof body.note === 'string' ? body.note.slice(0, 1000) : null,
      chargedById: user.id,
    },
    select: { id: true, status: true, amount: true, surchargeAmount: true },
  })

  // Clear it off Ana's queue. Only on approval — a decline leaves it READY so
  // the next person still sees it needs collecting.
  if (approved && finalInvoiceId) {
    await prisma.jobFinalInvoice
      .update({ where: { id: finalInvoiceId }, data: { status: 'COLLECTED' } })
      .catch((e) => console.error('[collections] could not mark collected:', e))
  }

  return NextResponse.json({
    ok: approved,
    chargeId: charge.id,
    status: charge.status,
    base,
    surcharge,
    total,
    authCode: resp.authcode ?? null,
    retref: resp.retref ?? null,
    message: approved
      ? `Approved — $${total.toFixed(2)} charged ($${base.toFixed(2)} + $${surcharge.toFixed(2)} fee).`
      : `Declined: ${resp.resptext || 'no reason given'}`,
  })
}
