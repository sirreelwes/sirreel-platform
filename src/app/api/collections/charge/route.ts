import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCollectionsUser } from '@/lib/collections/access'
import { resolveCardToken } from '@/lib/payments/companyCards'
import {
  chargeCard,
  isApproved,
  cardDisplayFromToken,
  appliedAmounts,
} from '@/lib/cardpointe/client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/collections/charge — take a card payment against a RentalWorks
 * invoice, for money collected before billing moves into HQ.
 *
 * Two token sources, both ending in the same charge:
 *   savedCardId +    → a card already on file. `savedCardOrigin` says which
 *   savedCardOrigin    table it lives in ('company' = the CompanyCard wallet,
 *                      'paperwork' = a legacy per-booking authorization).
 *                      Required, never guessed: both tables use uuids, and a
 *                      silent fallback between them is how a charge lands on
 *                      a card nobody chose. `savedPaperworkId` is the old
 *                      spelling of the paperwork case and still works.
 *   cardToken        → minted client-side by the CardSecure iframe when an
 *                      operator takes a card over the phone.
 *
 * WRONG-CLIENT GUARD: when the card on file belongs to a different company
 * than the invoice being settled, the charge is REFUSED unless the caller
 * passes confirmCrossClientCard. A parent company paying a subsidiary's
 * invoice is real, so this is a speed bump and not a wall — but it has to be
 * server-side, because the operator's list is the thing that misled them
 * (Ana, 2026-09-04). Only enforced when both sides are known; an RW-only
 * invoice has no HQ company and is left alone rather than blocked on a guess.
 *
 * The raw PAN never reaches this server on either path. `cardToken` is
 * already a CardSecure token when it arrives — the iframe posts to
 * CardConnect, not to us.
 *
 * SURCHARGE: the GATEWAY applies it, not us. We send the base amount and the
 * cardholder's postal code; CardPointe adds the fee per the Merchant Surcharge
 * Program and WAIVES it when the cardholder is ineligible — debit, prepaid, or
 * a state that prohibits surcharging (Connecticut, Massachusetts).
 *
 * This used to add 3% locally and send base + fee. Once surcharging is enabled
 * on the merchant account that double-charges the client, and it applied the
 * fee to debit cards and to prohibited states, which the card brands and
 * federal law forbid. The fee is now read back from the response — it is only
 * knowable there.
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
    savedCardId?: unknown
    savedCardOrigin?: unknown
    confirmCrossClientCard?: unknown
    cardholderName?: unknown
    pdfUrl?: unknown
    pdfKey?: unknown
    note?: unknown
    postal?: unknown
    cardType?: unknown
  } | null
  if (!body) return NextResponse.json({ ok: false, error: 'body required' }, { status: 400 })

  const finalInvoiceId =
    typeof body.finalInvoiceId === 'string' ? body.finalInvoiceId.trim() : ''

  // A charge is anchored to EITHER a finalized invoice (the normal path — an
  // agent agreed the number and queued it) or a raw RW invoice id (the older
  // path, still needed for anything finalized outside HQ).
  let rwInvoiceId = typeof body.rwInvoiceId === 'string' ? body.rwInvoiceId.trim() : ''
  // The client this invoice belongs to, for the wrong-client card guard.
  // Null on a raw RW invoice — RW customers aren't HQ companies.
  let invoiceCompanyId: string | null = null
  let invoiceCompanyName: string | null = null
  if (finalInvoiceId) {
    const fi = await prisma.jobFinalInvoice.findUnique({
      where: { id: finalInvoiceId },
      select: {
        id: true,
        rwInvoiceId: true,
        invoiceNumber: true,
        status: true,
        job: { select: { company: { select: { id: true, name: true } } } },
      },
    })
    if (!fi) {
      return NextResponse.json({ ok: false, error: 'final invoice not found' }, { status: 404 })
    }
    invoiceCompanyId = fi.job?.company?.id ?? null
    invoiceCompanyName = fi.job?.company?.name ?? null
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
  // Gateway needs this to decide surcharge eligibility. Operator-supplied for
  // a keyed card; taken from the signed authorization for a card on file.
  let cardPostal =
    typeof body.postal === 'string' ? body.postal.replace(/[^0-9-]/g, '').slice(0, 10) : ''

  const savedCardId =
    typeof body.savedCardId === 'string' && body.savedCardId.trim()
      ? body.savedCardId.trim()
      : typeof body.savedPaperworkId === 'string' && body.savedPaperworkId.trim()
        ? body.savedPaperworkId.trim()
        : ''
  // Default to 'paperwork' so the pre-wallet callers (savedPaperworkId alone)
  // keep resolving exactly where they always did.
  const savedCardOrigin: 'company' | 'paperwork' =
    body.savedCardOrigin === 'company' ? 'company' : 'paperwork'

  if (savedCardId) {
    const card = await resolveCardToken(savedCardOrigin, savedCardId)
    if (!card) {
      return NextResponse.json(
        { ok: false, error: 'that card is no longer on file' },
        { status: 400 },
      )
    }

    // Whose card is this? Only the wallet knows — a legacy paperwork card
    // reaches a company through its booking's job.
    const cardCompany = await cardCompanyFor(savedCardOrigin, savedCardId)
    if (
      invoiceCompanyId &&
      cardCompany?.id &&
      cardCompany.id !== invoiceCompanyId &&
      body.confirmCrossClientCard !== true
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            `That card is on file for ${cardCompany.name ?? 'another client'}, not ` +
            `${invoiceCompanyName ?? 'this client'}. Confirm you mean to charge it before it goes through.`,
          crossClientCard: {
            cardCompanyName: cardCompany.name,
            invoiceCompanyName,
          },
        },
        { status: 409 },
      )
    }

    cardToken = card.cardToken
    cardLast4 = card.last4
    cardType = card.cardType
    cardholderName = cardholderName || card.cardholderName || null
    // Captured with the authorization. The saved-card path used to leave this
    // empty, so a merchant-initiated charge against a card on file reached the
    // gateway with no expiry — the same defect the keyed path guards against
    // above, on the branch nobody had exercised yet.
    cardExpiry = card.expiry ?? ''
    cardPostal = cardPostal || (card.postal ?? '')
    // The client signed this authorization themselves — in the portal, or on
    // the written authorization a staff-keyed card is filed against. Either
    // way it is not a mail/telephone order.
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
      { ok: false, error: 'either savedCardId or cardToken is required' },
      { status: 400 },
    )
  }

  // Card brand for a KEYED charge comes from the operator, because it cannot
  // be recovered afterwards: a CardSecure token carries the last four but not
  // the BIN, and the gateway's auth response has no brand field either
  // (bintype comes back empty, and the BIN lookup returns nothing for a
  // token). The operator is holding the card details on the call, so asking
  // is the only reliable source — the same thing the portal does by having
  // the client pick their card type.
  //
  // A saved authorization already stored its brand; never overwrite that.
  const KNOWN_BRANDS = ['VISA', 'MASTERCARD', 'AMEX', 'DISCOVER']
  if (!cardType && typeof body.cardType === 'string') {
    const claimed = body.cardType.trim().toUpperCase()
    if (KNOWN_BRANDS.includes(claimed)) cardType = claimed
  }

  // Last-4 IS in the token, so it still comes from there. Brand falls back to
  // the token's best effort, which is usually null — an absent brand is
  // honest, a guessed one would be wrong in a dispute.
  if (!cardLast4 || !cardType) {
    const d = cardDisplayFromToken(cardToken)
    cardLast4 = cardLast4 ?? d.last4
    cardType = cardType ?? d.cardType
  }

  const invoiceNumber =
    typeof body.invoiceNumber === 'string' ? body.invoiceNumber.trim().slice(0, 60) : ''
  const customerName =
    typeof body.customerName === 'string' ? body.customerName.trim().slice(0, 200) : null

  // What the invoice is credited. The gateway decides what is added on top.
  const base = Math.round((amount + Number.EPSILON) * 100) / 100

  let resp: Awaited<ReturnType<typeof chargeCard>>
  try {
    resp = await chargeCard({
      cardToken,
      // BASE ONLY. The gateway applies the surcharge itself; sending
      // base + fee here would surcharge the client twice.
      amountDollars: base,
      invoiceNumber: invoiceNumber || rwInvoiceId,
      cardholderName: cardholderName ?? undefined,
      expiry: cardExpiry || undefined,
      postal: cardPostal || undefined,
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
        // Nothing reached the gateway, so no fee was applied.
        surchargeAmount: 0,
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

  // What the card was ACTUALLY charged, per the gateway. With surcharging on
  // this exceeds `base`; with it off, or for an ineligible cardholder, the
  // fee is zero and total === base.
  const { total, surcharge } = appliedAmounts(resp, base)

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
  // the next person still sees it needs collecting. Stamps how/when/who so
  // the collections tracker can answer "what happened to this invoice"
  // without cross-referencing the charge log.
  if (approved && finalInvoiceId) {
    await prisma.jobFinalInvoice
      .update({
        where: { id: finalInvoiceId },
        data: {
          status: 'COLLECTED',
          collectedAt: new Date(),
          collectedVia: 'CARD',
          collectedById: user.id,
        },
      })
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
    // Reports what the gateway actually did. A waived fee (debit, prepaid, or
    // a state that prohibits surcharging) must not read as "+ $0.00 fee" —
    // the operator needs to see that no fee applied, because the client was
    // told one would.
    message: approved
      ? surcharge > 0
        ? `Approved — $${total.toFixed(2)} charged ($${base.toFixed(2)} + $${surcharge.toFixed(2)} fee).`
        : `Approved — $${total.toFixed(2)} charged. No card fee applied (cardholder not eligible for surcharging).`
      : `Declined: ${resp.resptext || 'no reason given'}`,
  })
}

/**
 * The company a card on file belongs to.
 *
 * Wallet cards carry it directly. A legacy paperwork authorization reaches one
 * only through its booking's job — and may not reach one at all, in which case
 * the wrong-client guard stays quiet rather than blocking on an unknown.
 */
async function cardCompanyFor(
  origin: 'company' | 'paperwork',
  id: string,
): Promise<{ id: string; name: string | null } | null> {
  if (origin === 'company') {
    const c = await prisma.companyCard.findUnique({
      where: { id },
      select: { company: { select: { id: true, name: true } } },
    })
    return c?.company ? { id: c.company.id, name: c.company.name } : null
  }
  const p = await prisma.paperworkRequest.findUnique({
    where: { id },
    select: {
      booking: {
        select: {
          job: { select: { company: { select: { id: true, name: true } } } },
          orders: {
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { job: { select: { company: { select: { id: true, name: true } } } } },
          },
        },
      },
    },
  })
  const company =
    p?.booking?.job?.company ?? p?.booking?.orders?.[0]?.job?.company ?? null
  return company ? { id: company.id, name: company.name } : null
}
