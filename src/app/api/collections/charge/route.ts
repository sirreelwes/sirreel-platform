import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCollectionsUser } from '@/lib/collections/access'
import { chargeCard } from '@/lib/cardpointe/client'
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
    invoiceNumber?: unknown
    customerName?: unknown
    amount?: unknown
    cardToken?: unknown
    savedPaperworkId?: unknown
    cardholderName?: unknown
    pdfUrl?: unknown
    pdfKey?: unknown
    note?: unknown
  } | null
  if (!body) return NextResponse.json({ ok: false, error: 'body required' }, { status: 400 })

  const rwInvoiceId = typeof body.rwInvoiceId === 'string' ? body.rwInvoiceId.trim() : ''
  if (!rwInvoiceId) {
    return NextResponse.json({ ok: false, error: 'rwInvoiceId required' }, { status: 400 })
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
  }

  if (!cardToken) {
    return NextResponse.json(
      { ok: false, error: 'either savedPaperworkId or cardToken is required' },
      { status: 400 },
    )
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
      moto,
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

  const approved = resp.respcode === '00'

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
      status: approved ? 'APPROVED' : 'DECLINED',
      pdfUrl: typeof body.pdfUrl === 'string' ? body.pdfUrl : null,
      pdfKey: typeof body.pdfKey === 'string' ? body.pdfKey : null,
      note: typeof body.note === 'string' ? body.note.slice(0, 1000) : null,
      chargedById: user.id,
    },
    select: { id: true, status: true, amount: true, surchargeAmount: true },
  })

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
