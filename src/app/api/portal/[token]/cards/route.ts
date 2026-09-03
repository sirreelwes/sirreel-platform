import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  listCompanyCards,
  setDefaultCompanyCard,
  mirrorPaperworkCardToWallet,
} from '@/lib/payments/companyCards'

/**
 * The client's own view of the cards their company has on file, and which one
 * we should charge.
 *
 * Wes, 2026-09-03, on a client who had authorized one card and wanted to pay
 * with another: "we don't wanna remove the first card. We want to keep that,
 * but also add this card... have some way for clients to update their payment
 * options, add a card, set one as default for payment."
 *
 * ── Most of this already worked, invisibly ────────────────────────────────
 *
 * Every card authorized in the portal is already mirrored into the company
 * wallet (see the cc step in ../sign), and the wallet has always held more
 * than one — a second authorization ADDS a row rather than replacing the
 * first. What was missing was any way for the client to SEE that or to say
 * which card to use. So they had one lever, "authorize a card", and no way to
 * express "charge this one instead", which is why the request arrived as an
 * email to Ana instead of a click.
 *
 * ── What is deliberately not exposed ──────────────────────────────────────
 *
 * Never the CardSecure token, and never anything that could be used to charge.
 * Last four, brand, expiry, cardholder name and which is default — the same
 * facts a client already sees on any billing page, and enough to tell two of
 * their own cards apart.
 *
 * GET   → the cards on file
 * PATCH → { cardId } sets the default
 */

export const dynamic = 'force-dynamic'

/** The company behind a portal token. Job first — a booking's company can be
 *  null on call-in intake, while the job's is the billing relationship. */
async function companyForToken(token: string): Promise<string | null> {
  const pw = await prisma.paperworkRequest.findUnique({
    where: { token },
    select: { booking: { select: { companyId: true, job: { select: { companyId: true } } } } },
  })
  return pw?.booking?.job?.companyId ?? pw?.booking?.companyId ?? null
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const companyId = await companyForToken(params.token)
  if (!companyId) return NextResponse.json({ ok: true, cards: [] })

  const cards = await listCompanyCards(companyId)
  return NextResponse.json({
    ok: true,
    cards: cards.map((c) => ({
      id: c.id,
      last4: c.last4,
      cardType: c.cardType,
      expiry: c.expiry,
      cardholderName: c.cardholderName,
      isDefault: c.isDefault,
      expired: c.expired,
      label: c.label,
    })),
  })
}

export async function PATCH(req: NextRequest, { params }: { params: { token: string } }) {
  const companyId = await companyForToken(params.token)
  if (!companyId) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const cardId = typeof body.cardId === 'string' ? body.cardId : ''
  if (!cardId) return NextResponse.json({ error: 'cardId required' }, { status: 400 })

  // Scope check before the write: a card id from another company's wallet must
  // not become this company's default. The token proves which company the
  // caller speaks for, and nothing else.
  let walletCardId: string | null = (
    await prisma.companyCard.findFirst({ where: { id: cardId, companyId }, select: { id: true } })
  )?.id ?? null

  // Not a wallet card — so it is one of the LEGACY per-booking authorizations
  // listCompanyCards also returns, whose id is a PaperworkRequest. Most clients
  // are in exactly this state: the wallet only started filling on 2026-09-01,
  // and 4 companies have a wallet card while many more have an authorization.
  // Without this branch "Use this one" would 404 for nearly everybody.
  //
  // Mirroring is the same move the staff route makes, and it is idempotent —
  // the wallet dedupes on the CardSecure token, so re-picking the same card
  // does not create a second row.
  if (!walletCardId) {
    const pw = await prisma.paperworkRequest.findUnique({
      where: { id: cardId },
      select: { id: true, booking: { select: { companyId: true, job: { select: { companyId: true } } } } },
    })
    const pwCompany = pw?.booking?.job?.companyId ?? pw?.booking?.companyId ?? null
    if (pw && pwCompany === companyId) {
      walletCardId = await mirrorPaperworkCardToWallet(pw.id)
    }
  }

  if (!walletCardId) {
    return NextResponse.json({ error: 'That card is not on this account.' }, { status: 404 })
  }

  const ok = await setDefaultCompanyCard(companyId, walletCardId)
  if (!ok) return NextResponse.json({ error: 'Could not update the default card.' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
