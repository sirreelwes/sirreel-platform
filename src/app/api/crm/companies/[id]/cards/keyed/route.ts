/**
 * POST /api/crm/companies/[id]/cards/keyed — put a card on file that staff
 * keyed in from an authorization the client signed off-portal.
 *
 * Wes, 2026-09-02. Jose asked to drag a Cognito credit-card authorization
 * into HQ and have HQ read the card off it. The reading is the part that
 * can't happen: that PDF carries the full PAN (usually the CVV too), and a
 * copy in our storage is cardholder data at rest in a system that today holds
 * none. What Jose actually needs is to put the client's card on file without
 * making them redo it in the portal — which is this.
 *
 * The number never reaches this route. The browser mints the token in
 * CardConnect's own iframe (`?mode=card-on-file`, no CVV — a stored token
 * replays its CVV on every later charge, which is what Fiserv flagged on
 * 2026-08-14) and posts the token here. Same trust boundary as the portal
 * capture and the phone-keyed collections charge; the only new thing is that
 * a staffer, not the client, did the typing.
 *
 * That is exactly why `authorizationRef` is required and free-text: the
 * client's consent lives on paper we deliberately do not keep, so the wallet
 * has to carry a pointer to it — "Cognito CCA #4182, signed 9/2". Without one
 * this route is a way to put a stranger's card on a company's account.
 *
 * PROD only. A UAT token cannot be charged in production, and keying a real
 * client's card while pointed at the sandbox sends live cardholder data to a
 * test environment — which happened on 2026-08-13 and is what the `live` gate
 * exists to prevent. Collections stays open on UAT because it stores nothing;
 * this stores.
 *
 * Gated on requireCollectionsUser — the same predicate as charging a card.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCollectionsUser } from '@/lib/collections/access'
import {
  authorizeStoredCredential,
  cardDisplayFromToken,
  cardpointeEnv,
  isApproved,
} from '@/lib/cardpointe/client'
import { addKeyedCompanyCard, listCompanyCards, setDefaultCompanyCard } from '@/lib/payments/companyCards'

export const dynamic = 'force-dynamic'

const str = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : ''

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 403 })

  if (cardpointeEnv() !== 'PROD') {
    return NextResponse.json(
      {
        error:
          'This environment is pointed at the CardPointe sandbox. A card stored here could not be charged, and a real card must never be keyed into UAT.',
      },
      { status: 409 },
    )
  }

  const company = await prisma.company.findUnique({
    where: { id: params.id },
    select: { id: true, name: true },
  })
  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const cardToken = str(body.cardToken, 120)
  const expiry = str(body.expiry, 4)
  const billingPostal = str(body.billingPostal, 10)
  const cardholderName = str(body.cardholderName, 200)
  const authorizationRef = str(body.authorizationRef, 300)
  const label = str(body.label, 120) || null
  const cardType = str(body.cardType, 40) || null
  const paymentPreference = str(body.paymentPreference, 20) || null
  const sourceJobId = str(body.sourceJobId, 60) || null

  if (!cardToken) {
    return NextResponse.json({ error: 'Enter the card — it has not been tokenized yet.' }, { status: 400 })
  }
  if (!/^(0[1-9]|1[0-2])\d{2}$/.test(expiry)) {
    return NextResponse.json({ error: 'Pick the card expiry (MM/YY).' }, { status: 400 })
  }
  // The gateway judges surcharge eligibility from the cardholder's region on
  // card-not-present auths, so a ZIP is not optional once surcharging is on.
  if (!/^\d{5}(-\d{4})?$/.test(billingPostal)) {
    return NextResponse.json({ error: 'Enter the billing ZIP on the authorization.' }, { status: 400 })
  }
  if (!cardholderName) {
    return NextResponse.json({ error: 'Enter the cardholder name as written on the authorization.' }, { status: 400 })
  }
  if (authorizationRef.length < 4) {
    return NextResponse.json(
      { error: 'Say where the signed authorization lives — e.g. "Cognito CCA #4182, signed 9/2".' },
      { status: 400 },
    )
  }
  if (sourceJobId) {
    const job = await prisma.job.findUnique({ where: { id: sourceJobId }, select: { companyId: true } })
    if (!job || job.companyId !== company.id) {
      return NextResponse.json({ error: 'That job is not on this company.' }, { status: 400 })
    }
  }

  // $0 stored-credential authorization — the same validation the portal runs.
  // It proves the card is live and gives later merchant-initiated charges the
  // retref the card-brand framework wants them to reference.
  let auth = {
    retref: null as string | null,
    respcode: null as string | null,
    respstat: null as string | null,
    resptext: null as string | null,
    validatedAt: null as Date | null,
  }
  let approved = false
  try {
    const zero = await authorizeStoredCredential({
      cardToken,
      expiry,
      cardholderName,
      reference: `KEYED-${company.id.slice(0, 12)}`,
      postal: billingPostal,
    })
    auth = {
      retref: zero.retref ?? null,
      respcode: zero.respcode ?? null,
      respstat: zero.respstat ?? null,
      resptext: zero.resptext?.slice(0, 300) ?? null,
      validatedAt: new Date(),
    }
    approved = isApproved(zero)
  } catch (err) {
    console.error('[keyed-card] $0 validation threw:', err)
    return NextResponse.json(
      { error: 'Payment gateway unreachable — nothing was stored. Try again.' },
      { status: 502 },
    )
  }

  // A card that does not validate is not put on file. The portal stores an
  // unapproved authorization because a client is standing there and the rest
  // of their paperwork must not be lost; here there is nothing else in flight,
  // and a wallet card that declines is a charge that fails later in front of
  // the client.
  if (!approved) {
    return NextResponse.json(
      {
        error: `The card did not authorize — ${[auth.respcode, auth.resptext].filter(Boolean).join(' ') || 'declined'}. Nothing was stored.`,
      },
      { status: 402 },
    )
  }

  const display = cardDisplayFromToken(cardToken)
  const { cardId, created } = await addKeyedCompanyCard({
    companyId: company.id,
    cardToken,
    expiry,
    billingPostal,
    cardholderName,
    authorizationRef,
    label,
    paymentPreference,
    sourceJobId,
    addedById: user.id,
    auth,
    last4: display.last4,
    cardType: cardType ?? display.cardType,
  })
  if (body.makeDefault === true) await setDefaultCompanyCard(company.id, cardId)

  // The audit row is the durable answer to "who put this card here, and on
  // what authority" — it survives the card being taken off file.
  await prisma.auditLog
    .create({
      data: {
        action: 'company_card.keyed',
        entityType: 'Company',
        entityId: company.id,
        userId: user.id,
        newValues: {
          companyCardId: cardId,
          created,
          last4: display.last4,
          authorizationRef,
          sourceJobId,
          authRetref: auth.retref,
        },
      },
    })
    .catch((err) => console.error('[keyed-card] audit write failed', company.id, err))

  return NextResponse.json({
    ok: true,
    cardId,
    created,
    authRetref: auth.retref,
    cards: await listCompanyCards(company.id),
  })
}
