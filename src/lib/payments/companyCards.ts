/**
 * A company's wallet of cards on file.
 *
 * Wes, 2026-09-01: "some companies like to keep more than one credit card on
 * file." They could not. The stored CardSecure token lived in
 * PaperworkRequest.ccCardNumberEncrypted — one column, one row, keyed to a
 * BOOKING — and every reader took findFirst() ordered by date. A production
 * with an AmEx for gear and a Visa for vehicles had, as far as HQ was
 * concerned, whichever one was authorized most recently.
 *
 * This module is the wallet's read side. Two rules it never breaks:
 *
 *   1. `cardToken` NEVER leaves the server. Display fields exist so staff
 *      surfaces never need it; charge endpoints take a card ID and resolve
 *      the token here. A token in a JSON response is a token in a browser
 *      history, a proxy log and a screenshot.
 *   2. The legacy paperwork cards stay readable. They are real cards clients
 *      really authorized, and dropping them to ship a wallet would take away
 *      the only card on file for every existing job.
 */
import { prisma } from '@/lib/prisma'

/** Never includes cardToken. Safe to serialize to a staff browser. */
export interface CardOnFileSummary {
  id: string
  /** 'company' — a wallet card; 'paperwork' — a legacy per-booking auth. */
  origin: 'company' | 'paperwork'
  label: string | null
  last4: string | null
  cardType: string | null
  expiry: string | null
  cardholderName: string | null
  isDefault: boolean
  paymentPreference: 'CARD' | 'CHECK_WIRE' | null
  authorizedAt: Date | null
  /** True when the $0 stored-credential authorization came back approved. */
  validated: boolean
  /** MM/YY already past. Not a hard block — the gateway decides — but staff
   *  should see it before reaching for the card. */
  expired: boolean
}

function normalizePreference(v: string | null | undefined): 'CARD' | 'CHECK_WIRE' | null {
  return v === 'CHECK_WIRE' ? 'CHECK_WIRE' : v === 'CARD' ? 'CARD' : null
}

/**
 * Is an MMYY expiry in the past? A card expires at the END of its month.
 * Returns false for anything unparseable — an unknown expiry is not evidence
 * of an expired card, and flagging it would train staff to ignore the flag.
 */
export function isExpiryPast(expiry: string | null | undefined, now: Date = new Date()): boolean {
  if (!expiry || !/^\d{4}$/.test(expiry)) return false
  const mm = Number(expiry.slice(0, 2))
  const yy = Number(expiry.slice(2, 4))
  if (mm < 1 || mm > 12) return false
  // First instant of the month AFTER the expiry month, in UTC.
  const expiresAfter = Date.UTC(2000 + yy, mm, 1)
  return now.getTime() >= expiresAfter
}

/**
 * Every card on file for a company — wallet cards first (default first),
 * then legacy per-booking authorizations reached through the company's jobs.
 */
export async function listCompanyCards(companyId: string): Promise<CardOnFileSummary[]> {
  const [wallet, legacy] = await Promise.all([
    prisma.companyCard.findMany({
      where: { companyId, removedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true, label: true, last4: true, cardType: true, expiry: true,
        cardholderName: true, isDefault: true, paymentPreference: true,
        authValidatedAt: true, authRespStat: true, createdAt: true,
      },
    }),
    prisma.paperworkRequest.findMany({
      where: {
        ccCardNumberEncrypted: { not: null },
        booking: { job: { companyId } },
      },
      orderBy: [{ ccAuthSignedAt: 'desc' }],
      take: 50,
      select: {
        id: true, ccCardholderFirst: true, ccCardholderLast: true,
        ccCardType: true, ccCardLast4: true, ccCardExpiry: true,
        ccAuthSignedAt: true, ccPaymentPreference: true,
        ccAuthRespStat: true, ccAuthValidatedAt: true,
        ccCardNumberEncrypted: true,
      },
    }),
  ])

  // A card migrated into the wallet is still sitting on its paperwork row —
  // dedupe on the token so staff don't see the same card twice.
  const walletTokens = new Set(
    (
      await prisma.companyCard.findMany({
        where: { companyId, removedAt: null },
        select: { cardToken: true },
      })
    ).map((c) => c.cardToken),
  )

  const now = new Date()

  const walletCards: CardOnFileSummary[] = wallet.map((c) => ({
    id: c.id,
    origin: 'company',
    label: c.label,
    last4: c.last4,
    cardType: c.cardType,
    expiry: c.expiry,
    cardholderName: c.cardholderName,
    isDefault: c.isDefault,
    paymentPreference: normalizePreference(c.paymentPreference),
    authorizedAt: c.authValidatedAt ?? c.createdAt,
    validated: c.authRespStat === 'A',
    expired: isExpiryPast(c.expiry, now),
  }))

  const legacyCards: CardOnFileSummary[] = legacy
    .filter((p) => p.ccCardNumberEncrypted && !walletTokens.has(p.ccCardNumberEncrypted))
    .map((p) => ({
      id: p.id,
      origin: 'paperwork',
      label: null,
      last4: p.ccCardLast4,
      cardType: p.ccCardType,
      expiry: p.ccCardExpiry,
      cardholderName:
        [p.ccCardholderFirst, p.ccCardholderLast].filter(Boolean).join(' ').trim() || null,
      isDefault: false,
      paymentPreference: normalizePreference(p.ccPaymentPreference),
      authorizedAt: p.ccAuthSignedAt,
      validated: p.ccAuthRespStat === 'A',
      expired: isExpiryPast(p.ccCardExpiry, now),
    }))

  return [...walletCards, ...legacyCards]
}

export interface ResolvedCardToken {
  cardToken: string
  last4: string | null
  cardType: string | null
  expiry: string | null
  postal: string | null
  cardholderName: string | null
  label: string | null
  origin: 'company' | 'paperwork'
  /** The wallet row id, when this came from the wallet. */
  companyCardId: string | null
  /** The paperwork row id, when this came from a legacy authorization. */
  paperworkRequestId: string | null
  paymentPreference: 'CARD' | 'CHECK_WIRE' | null
  /** When the stored credential was established. */
  authorizedAt: Date | null
}

/**
 * Resolve ONE card to a chargeable token.
 *
 * `origin` is required from the caller rather than guessed from the id
 * shape: both tables use uuids, and a silent fallback between them is how a
 * charge ends up on a card nobody chose.
 */
export async function resolveCardToken(
  origin: 'company' | 'paperwork',
  id: string,
): Promise<ResolvedCardToken | null> {
  if (origin === 'company') {
    const c = await prisma.companyCard.findFirst({
      where: { id, removedAt: null },
      select: {
        id: true, cardToken: true, last4: true, cardType: true, expiry: true,
        billingPostal: true, cardholderName: true, label: true,
        paymentPreference: true, authValidatedAt: true, sourcePaperworkRequestId: true,
      },
    })
    if (!c) return null
    return {
      cardToken: c.cardToken,
      last4: c.last4,
      cardType: c.cardType,
      expiry: c.expiry,
      postal: c.billingPostal,
      cardholderName: c.cardholderName,
      label: c.label,
      origin: 'company',
      companyCardId: c.id,
      // The authorization this card was mirrored from, so a charge can still
      // point at the signed paperwork that makes it enforceable.
      paperworkRequestId: c.sourcePaperworkRequestId,
      paymentPreference: normalizePreference(c.paymentPreference),
      authorizedAt: c.authValidatedAt,
    }
  }

  const p = await prisma.paperworkRequest.findUnique({
    where: { id },
    select: {
      id: true, ccCardNumberEncrypted: true, ccCardLast4: true, ccCardType: true,
      ccCardExpiry: true, ccBillingPostal: true, ccCardholderFirst: true, ccCardholderLast: true,
      ccPaymentPreference: true, ccAuthSignedAt: true,
    },
  })
  if (!p?.ccCardNumberEncrypted) return null
  return {
    cardToken: p.ccCardNumberEncrypted,
    last4: p.ccCardLast4,
    cardType: p.ccCardType,
    expiry: p.ccCardExpiry,
    postal: p.ccBillingPostal,
    cardholderName:
      [p.ccCardholderFirst, p.ccCardholderLast].filter(Boolean).join(' ').trim() || null,
    label: null,
    origin: 'paperwork',
    companyCardId: null,
    paperworkRequestId: p.id,
    paymentPreference: normalizePreference(p.ccPaymentPreference),
    authorizedAt: p.ccAuthSignedAt,
  }
}

/**
 * The company's default card, if it has a wallet.
 *
 * "Default" is explicit, never inferred: with several cards on file, picking
 * the newest is a guess, and a guess that charges the wrong card is a call
 * from the client's accounting department. Returns null when the wallet is
 * empty (callers fall back to the legacy paperwork chain) or when it has
 * cards but no default set — a company that keeps two cards on purpose
 * should be asked which one, not handed one.
 */
export async function resolveCompanyDefaultCard(
  companyId: string,
): Promise<ResolvedCardToken | null> {
  const c = await prisma.companyCard.findFirst({
    where: { companyId, removedAt: null, isDefault: true },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (!c) return null
  return resolveCardToken('company', c.id)
}

/**
 * Make one card the company's default, clearing any other.
 *
 * Serialized in a transaction: two staff setting different defaults at once
 * must not leave a company with two, which would put the "which card do we
 * charge?" question back exactly where it started.
 */
export async function setDefaultCompanyCard(companyId: string, cardId: string): Promise<boolean> {
  const card = await prisma.companyCard.findFirst({
    where: { id: cardId, companyId, removedAt: null },
    select: { id: true },
  })
  if (!card) return false
  await prisma.$transaction([
    prisma.companyCard.updateMany({
      where: { companyId, isDefault: true, NOT: { id: card.id } },
      data: { isDefault: false },
    }),
    prisma.companyCard.update({ where: { id: card.id }, data: { isDefault: true } }),
  ])
  return true
}

/**
 * Mirror a completed portal card authorization into the company's wallet.
 *
 * The paperwork row stays the record of the AUTHORIZATION — who signed it,
 * for which booking, under which agreement — and is untouched. The wallet
 * row is the record of the CARD: which company it belongs to, what to call
 * it, whether it's the default. Two different questions, and conflating them
 * is what made a second card impossible in the first place.
 *
 * Idempotent on (companyId, cardToken): the same card authorized again on a
 * later job updates the existing wallet entry rather than adding a duplicate
 * the client would then have to be asked to disambiguate. A re-authorization
 * carries fresher expiry/postal/validation, so those are refreshed; the
 * human-set `label` and `isDefault` are NOT — staff set those deliberately
 * and a client re-authorizing must not silently undo them.
 *
 * The FIRST card a company puts on file becomes its default. That is not a
 * guess: with one card there is nothing to choose between, and leaving it
 * unset would mean a company with exactly one card on file still gets asked
 * which one to charge.
 *
 * Best-effort by contract — callers must not fail a client's paperwork
 * submission over the mirror. The paperwork row is already written and the
 * legacy read paths still resolve it.
 */
export async function mirrorPaperworkCardToWallet(
  paperworkRequestId: string,
): Promise<string | null> {
  const pw = await prisma.paperworkRequest.findUnique({
    where: { id: paperworkRequestId },
    select: {
      id: true,
      ccCardNumberEncrypted: true,
      ccCardLast4: true,
      ccCardType: true,
      ccCardExpiry: true,
      ccBillingPostal: true,
      ccCardholderFirst: true,
      ccCardholderLast: true,
      ccPaymentPreference: true,
      ccAuthRetref: true,
      ccAuthRespCode: true,
      ccAuthRespStat: true,
      ccAuthRespText: true,
      ccAuthValidatedAt: true,
      booking: { select: { id: true, jobId: true, job: { select: { companyId: true } } } },
    },
  })
  if (!pw?.ccCardNumberEncrypted) return null

  const companyId = pw.booking?.job?.companyId
  if (!companyId) return null

  const cardholderName =
    [pw.ccCardholderFirst, pw.ccCardholderLast].filter(Boolean).join(' ').trim() || null

  const existing = await prisma.companyCard.findUnique({
    where: { companyId_cardToken: { companyId, cardToken: pw.ccCardNumberEncrypted } },
    select: { id: true, removedAt: true },
  })

  const liveCount = await prisma.companyCard.count({
    where: { companyId, removedAt: null },
  })

  const gatewayFields = {
    last4: pw.ccCardLast4,
    cardType: pw.ccCardType,
    expiry: pw.ccCardExpiry,
    billingPostal: pw.ccBillingPostal,
    cardholderName,
    paymentPreference: pw.ccPaymentPreference,
    authRetref: pw.ccAuthRetref,
    authRespCode: pw.ccAuthRespCode,
    authRespStat: pw.ccAuthRespStat,
    authRespText: pw.ccAuthRespText,
    authValidatedAt: pw.ccAuthValidatedAt,
  }

  if (existing) {
    await prisma.companyCard.update({
      where: { id: existing.id },
      data: {
        ...gatewayFields,
        // A client re-authorizing a card they had removed is putting it back
        // on file — that is the whole meaning of the action.
        removedAt: null,
        removedById: null,
        sourcePaperworkRequestId: pw.id,
        sourceJobId: pw.booking?.jobId ?? null,
      },
    })
    return existing.id
  }

  const created = await prisma.companyCard.create({
    data: {
      companyId,
      cardToken: pw.ccCardNumberEncrypted,
      ...gatewayFields,
      isDefault: liveCount === 0,
      source: 'PAPERWORK',
      sourcePaperworkRequestId: pw.id,
      sourceJobId: pw.booking?.jobId ?? null,
    },
    select: { id: true },
  })
  return created.id
}
