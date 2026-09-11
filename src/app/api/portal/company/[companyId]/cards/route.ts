/**
 * /api/portal/company/[companyId]/cards — the production company's cards on
 * file, seen and added from its OWN account portal.
 *
 * Wes 2026-09-11, after Nancy at Happy Place (accounting) could not find
 * where to put a card down on the Birdie job: "often the person who sends
 * the credit card isn't the production team client... perhaps an
 * accounting login for production companies?" The account portal already
 * had a Finance seat and no card surface. This is the card surface.
 *
 *   GET   → cards on file (display fields only — never the token)
 *   POST  → authorize a card into the company wallet
 *   PATCH → { cardId } picks which card to charge
 *
 * ── Who may add ────────────────────────────────────────────────────────
 * Anyone with a live grant. Not just FINANCE: clients add their own people
 * and every one of those is locked to role OTHER (people/route.ts), so an
 * accounting person a producer invites would be exactly the seat a role
 * gate blocked. The cardholder signs for the card either way; the seat
 * just says who typed it. No removals here — a card comes off file through
 * the rep (soft-removed; a settled charge references the row).
 *
 * ── Trust boundary ─────────────────────────────────────────────────────
 * The number never reaches this route. CardSecure's iframe mints the token
 * (`?mode=card-on-file`, CVV-free — a stored token replays its CVV on every
 * later charge, which Fiserv flagged 2026-08-14) and the browser posts the
 * token here with the expiry and billing ZIP the gateway needs. The $0
 * stored-credential auth must APPROVE or nothing is stored, like the
 * staff-keyed path: a wallet card is charged later, unattended, and one
 * that declines is a failure in front of the client at invoice time.
 *
 * PROD only — a UAT token cannot be charged and a real card must never
 * reach the sandbox (the `live` gate the config route already applies to
 * the iframe; this is the server-side half).
 *
 * The signed authorization lives in AuditLog `company_card.client_added`:
 * the acknowledgment text as shown, the signature image, who was signed in.
 * `CompanyCard.authorizationRef` points at it, so the wallet answers "on
 * what authority" the same way it does for a staff-keyed card.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyPortalSessionFromRequest } from '@/lib/portal/companyPortal'
import {
  authorizeStoredCredential,
  cardDisplayFromToken,
  cardpointeEnv,
  isApproved,
} from '@/lib/cardpointe/client'
import { addClientCompanyCard, setDefaultCompanyCard } from '@/lib/payments/companyCards'
import { listClientCards } from '@/lib/portal/companyPortalCards'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { checkRateLimit } from '@/lib/portal/publicRateLimit'
import { CC_ACK_TEXT, CC_GUARANTEE_TEXT, CC_SURCHARGE_TEXT } from '@/components/portal-v2/terms'

export const dynamic = 'force-dynamic'

/** Ten attempts an hour per seat — a bank declining twice is normal, a
 *  script is not. */
const RATE = { windowMs: 60 * 60_000, max: 10 }

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export async function GET(req: NextRequest, { params }: { params: { companyId: string } }) {
  const session = await getCompanyPortalSessionFromRequest(req, params.companyId)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, cards: await listClientCards(session.companyId) })
}

export async function PATCH(req: NextRequest, { params }: { params: { companyId: string } }) {
  const session = await getCompanyPortalSessionFromRequest(req, params.companyId)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = (await req.json().catch(() => ({}))) as { cardId?: unknown }
  const cardId = str(body.cardId, 60)
  if (!cardId) return NextResponse.json({ error: 'cardId required' }, { status: 400 })
  const ok = await setDefaultCompanyCard(session.companyId, cardId)
  if (!ok) return NextResponse.json({ error: 'That card is not on this account.' }, { status: 404 })
  await prisma.auditLog
    .create({
      data: {
        action: 'company_card.client_default',
        entityType: 'Company',
        entityId: session.companyId,
        newValues: { companyCardId: cardId, byAccessId: session.accessId, byName: session.personName },
      },
    })
    .catch(() => null)
  return NextResponse.json({ ok: true, cards: await listClientCards(session.companyId) })
}

export async function POST(req: NextRequest, { params }: { params: { companyId: string } }) {
  const session = await getCompanyPortalSessionFromRequest(req, params.companyId)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (cardpointeEnv() !== 'PROD') {
    return NextResponse.json(
      { error: 'Card entry is not available right now. Your rep can take the authorization another way.' },
      { status: 409 },
    )
  }

  const rl = checkRateLimit(`company-portal-cards:${session.accessId}`, RATE)
  if (!rl.ok) {
    return NextResponse.json(
      { error: "That's a lot of attempts in a short time — try again in a while, or ask your rep." },
      { status: 429 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const cardToken = str(body.cardToken, 120)
  const expiry = str(body.expiry, 4)
  const billingPostal = str(body.billingPostal, 10)
  const cardholderName = str(body.cardholderName, 200)
  const paymentPreference = str(body.paymentPreference, 20) || null
  const signatureData = str(body.signatureData, 200_000)
  const acknowledged = body.acknowledged === true

  if (!cardToken) {
    return NextResponse.json({ error: 'Enter the card number first — it has not been captured yet.' }, { status: 400 })
  }
  if (!/^(0[1-9]|1[0-2])\d{2}$/.test(expiry)) {
    return NextResponse.json({ error: 'Pick the card expiry (month and year).' }, { status: 400 })
  }
  if (!/^\d{5}(-\d{4})?$/.test(billingPostal)) {
    return NextResponse.json({ error: 'Enter the billing ZIP for this card.' }, { status: 400 })
  }
  if (cardholderName.length < 2) {
    return NextResponse.json({ error: 'Enter the cardholder name as it appears on the card.' }, { status: 400 })
  }
  if (!acknowledged) {
    return NextResponse.json({ error: 'Tick the authorization box to continue.' }, { status: 400 })
  }
  if (!signatureData.startsWith('data:image/')) {
    return NextResponse.json({ error: 'Sign in the box to authorize the card.' }, { status: 400 })
  }

  const company = await prisma.company.findUnique({
    where: { id: session.companyId },
    select: { id: true, name: true, defaultAgent: { select: { name: true, email: true } } },
  })
  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The stored-credential authorization — the same validation every other
  // card-on-file path runs. $0 for Visa/MC; an Amex that refuses $0 gets a
  // $1 auth-only that is voided immediately (authorizeStoredCredential).
  let auth = {
    retref: null as string | null,
    respcode: null as string | null,
    respstat: null as string | null,
    resptext: null as string | null,
    validatedAt: null as Date | null,
  }
  let approved = false
  let verifiedAmount = '0'
  let holdReleased: boolean | undefined
  try {
    const zero = await authorizeStoredCredential({
      cardToken,
      expiry,
      cardholderName,
      reference: `ACCT-${company.id.slice(0, 12)}`,
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
    verifiedAmount = zero.verifiedAmount
    holdReleased = zero.holdReleased
  } catch (err) {
    console.error('[company-portal-cards] validation threw:', err)
    return NextResponse.json(
      { error: 'Our payment processor did not answer — nothing was stored. Try again in a minute.' },
      { status: 502 },
    )
  }

  const display = cardDisplayFromToken(cardToken)
  const hq = await channelRecipients('portal-cards').catch(() => [] as string[])
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')

  if (!approved) {
    // The bank said no. Nothing is stored, the client is told plainly, and
    // the desk hears about it now — a card is usually needed same or next
    // day, and only a person can sort a decline out (card-trouble rule).
    const reason = [auth.respcode, auth.resptext].filter(Boolean).join(' ') || 'declined'
    await prisma.auditLog
      .create({
        data: {
          action: 'company_card.client_declined',
          entityType: 'Company',
          entityId: company.id,
          newValues: { byAccessId: session.accessId, byName: session.personName, last4: display.last4, reason },
        },
      })
      .catch(() => null)
    if (hq.length > 0) {
      const line = `${session.personName} (${session.personEmail}) tried to put a card ending ${display.last4 ?? '????'} on file for ${company.name} in the account portal and the bank refused the verification: ${reason}. Nothing was stored.`
      await sendAgreementEmail({
        to: hq,
        subject: `Card verification refused — ${company.name} account portal`,
        html: `<p>${line}</p><p><a href="${base}/crm/${company.id}#cards">${base}/crm/${company.id}#cards</a></p>`,
        text: `${line}\n\n${base}/crm/${company.id}#cards`,
        label: 'company-portal-card-declined',
      }).catch(() => null)
    }
    return NextResponse.json(
      { error: `Your bank did not approve this card (${reason}). Nothing was stored — try another card, or call the number on the back of this one.` },
      { status: 402 },
    )
  }

  // The signed authorization, kept before the card so a wallet row can
  // never exist without its evidence. Text is snapshotted as shown: the
  // wording can change later; what this person agreed to cannot.
  const evidenceValues = {
        byAccessId: session.accessId,
        byPersonId: session.personId,
        byName: session.personName,
        byEmail: session.personEmail,
        byRole: session.role,
        cardholderName,
        last4: display.last4,
        cardType: display.cardType,
        expiry,
        paymentPreference,
        acknowledgmentText: CC_ACK_TEXT,
        guaranteeText: CC_GUARANTEE_TEXT,
        surchargeText: CC_SURCHARGE_TEXT,
        signatureData,
        authRetref: auth.retref,
        verifiedAmount,
        holdReleased: holdReleased ?? null,
        ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  }
  const evidence = await prisma.auditLog.create({
    data: {
      action: 'company_card.client_added',
      entityType: 'Company',
      entityId: company.id,
      newValues: evidenceValues,
    },
    select: { id: true, createdAt: true },
  })

  const signedOn = evidence.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const { cardId, created } = await addClientCompanyCard({
    companyId: company.id,
    cardToken,
    expiry,
    billingPostal,
    cardholderName,
    authorizationRef: `Signed in the account portal by ${session.personName} on ${signedOn} (audit ${evidence.id})`,
    paymentPreference,
    auth,
    last4: display.last4,
    cardType: display.cardType,
  })
  // Json is replaced, not merged — carry the evidence forward with the row id.
  await prisma.auditLog
    .update({ where: { id: evidence.id }, data: { newValues: { ...evidenceValues, companyCardId: cardId, created } } })
    .catch(() => null)
  if (body.makeDefault === true) await setDefaultCompanyCard(company.id, cardId)

  if (hq.length > 0) {
    const line = `${session.personName} (${session.personEmail}) put a ${display.cardType ?? 'card'} ending ${display.last4 ?? '????'} on file for ${company.name} from the account portal — cardholder ${cardholderName}. It covers every show on the account.`
    await sendAgreementEmail({
      to: hq,
      subject: `${company.name} added a card on file`,
      html: `<p>${line}</p><p><a href="${base}/crm/${company.id}#cards">${base}/crm/${company.id}#cards</a></p>`,
      text: `${line}\n\n${base}/crm/${company.id}#cards`,
      label: 'company-portal-card-added',
    }).catch(() => null)
  }

  const notice =
    verifiedAmount === '1.00'
      ? holdReleased
        ? 'This card would not take a $0 verification, so it was verified with a $1 authorization that has already been released. You may briefly see a $1 pending charge.'
        : 'This card was verified with a $1 authorization that could not be released immediately. Nothing was captured — the hold will drop off on its own, usually within a few days.'
      : null

  return NextResponse.json({ ok: true, cardId, created, notice, cards: await listClientCards(company.id) })
}
