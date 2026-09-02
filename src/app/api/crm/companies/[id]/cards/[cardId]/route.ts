/**
 * PATCH  /api/crm/companies/[id]/cards/[cardId] — rename a card on file, or
 *        make it the company's default.
 * DELETE /api/crm/companies/[id]/cards/[cardId] — take a card off file.
 *
 * DELETE is a SOFT remove. A settled charge references this row for dispute
 * evidence and "which card did we run?" has to stay answerable long after a
 * client swaps their AmEx — hard-deleting the row would take the answer with
 * it. The card stops being offered immediately either way.
 *
 * Removing the default leaves the company with NO default rather than
 * promoting the next card. Promotion would be a guess about which of the
 * remaining cards the client wants charged — the exact guess the wallet
 * exists to eliminate.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCollectionsUser } from '@/lib/collections/access'
import { listCompanyCards, setDefaultCompanyCard } from '@/lib/payments/companyCards'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string; cardId: string } }

async function loadCard(companyId: string, cardId: string) {
  return prisma.companyCard.findFirst({
    where: { id: cardId, companyId, removedAt: null },
    select: { id: true, label: true, isDefault: true, last4: true },
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 403 })

  const card = await loadCard(params.id, params.cardId)
  if (!card) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as { label?: unknown; isDefault?: unknown }

  if (typeof body.label === 'string') {
    await prisma.companyCard.update({
      where: { id: card.id },
      data: { label: body.label.trim().slice(0, 120) || null },
    })
  }
  if (body.isDefault === true) {
    await setDefaultCompanyCard(params.id, card.id)
  } else if (body.isDefault === false && card.isDefault) {
    await prisma.companyCard.update({ where: { id: card.id }, data: { isDefault: false } })
  }

  await prisma.auditLog
    .create({
      data: {
        action: 'company_card.updated',
        entityType: 'Company',
        entityId: params.id,
        userId: user.id,
        oldValues: { companyCardId: card.id, label: card.label, isDefault: card.isDefault },
        newValues: {
          label: typeof body.label === 'string' ? body.label.trim().slice(0, 120) || null : card.label,
          isDefault: typeof body.isDefault === 'boolean' ? body.isDefault : card.isDefault,
        },
      },
    })
    .catch((err) => console.error('[company-cards] audit write failed', params.id, err))

  return NextResponse.json({ ok: true, cards: await listCompanyCards(params.id) })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 403 })

  const card = await loadCard(params.id, params.cardId)
  if (!card) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.companyCard.update({
    where: { id: card.id },
    data: { removedAt: new Date(), removedById: user.id, isDefault: false },
  })

  await prisma.auditLog
    .create({
      data: {
        action: 'company_card.removed',
        entityType: 'Company',
        entityId: params.id,
        userId: user.id,
        oldValues: { companyCardId: card.id, label: card.label, last4: card.last4, isDefault: card.isDefault },
      },
    })
    .catch((err) => console.error('[company-cards] audit write failed', params.id, err))

  return NextResponse.json({ ok: true, cards: await listCompanyCards(params.id) })
}
