/**
 * GET  /api/crm/companies/[id]/cards — every card on file for a company.
 * POST /api/crm/companies/[id]/cards — adopt a legacy per-booking
 *      authorization into the company's wallet so it can be labelled and made
 *      the default.
 *
 * Wes, 2026-09-01: "some companies like to keep more than one credit card on
 * file."
 *
 * ── What this deliberately does NOT do ─────────────────────────────
 *
 * There is no staff path to ADD a card by typing a number. Card capture is
 * client-side tokenization through the portal, and it stays that way:
 * accepting a PAN on a staff form would put SirReel's own screens, request
 * logs and this route inside PCI scope for no gain, and the client is the
 * one who has to sign the authorization anyway. Staff organise the wallet
 * (label, default, remove); clients fill it.
 *
 * The token never crosses the wire in either direction. Charge endpoints
 * take a card ID and resolve the token server-side.
 *
 * Gated on requireCollectionsUser — the same predicate that guards actually
 * charging a card, which is the right blast radius for deciding which card
 * gets charged.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCollectionsUser } from '@/lib/collections/access'
import {
  listCompanyCards,
  mirrorPaperworkCardToWallet,
  setDefaultCompanyCard,
} from '@/lib/payments/companyCards'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 403 })

  const company = await prisma.company.findUnique({
    where: { id: params.id },
    select: { id: true, name: true },
  })
  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const cards = await listCompanyCards(company.id)
  return NextResponse.json({ company, cards })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 403 })

  const company = await prisma.company.findUnique({
    where: { id: params.id },
    select: { id: true },
  })
  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as {
    paperworkRequestId?: unknown
    label?: unknown
    makeDefault?: unknown
  }
  const paperworkRequestId =
    typeof body.paperworkRequestId === 'string' ? body.paperworkRequestId : ''
  if (!paperworkRequestId) {
    return NextResponse.json(
      { error: 'paperworkRequestId is required — cards are captured in the client portal.' },
      { status: 400 },
    )
  }

  // Scope check BEFORE the mirror: a paperwork id from another company's job
  // must not be adoptable into this wallet.
  const pw = await prisma.paperworkRequest.findUnique({
    where: { id: paperworkRequestId },
    select: { id: true, booking: { select: { job: { select: { companyId: true } } } } },
  })
  if (!pw || pw.booking?.job?.companyId !== company.id) {
    return NextResponse.json({ error: 'That authorization is not on this company.' }, { status: 404 })
  }

  const cardId = await mirrorPaperworkCardToWallet(paperworkRequestId)
  if (!cardId) {
    return NextResponse.json(
      { error: 'That authorization has no stored card to add.' },
      { status: 409 },
    )
  }

  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 120) || null : null
  if (label) {
    await prisma.companyCard.update({ where: { id: cardId }, data: { label, addedById: user.id } })
  }
  if (body.makeDefault === true) await setDefaultCompanyCard(company.id, cardId)

  await prisma.auditLog
    .create({
      data: {
        action: 'company_card.added',
        entityType: 'Company',
        entityId: company.id,
        userId: user.id,
        newValues: { companyCardId: cardId, fromPaperworkRequestId: paperworkRequestId, label },
      },
    })
    .catch((err) => console.error('[company-cards] audit write failed', company.id, err))

  return NextResponse.json({ ok: true, cardId, cards: await listCompanyCards(company.id) })
}
