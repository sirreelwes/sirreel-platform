/**
 * POST /api/crm/portals/company — open an account portal for a production
 * company in one step: grant the first people, optionally copy another
 * account's deal.
 *
 * Wes 2026-09-16: "create a button on that page for me to build new portals
 * without having to go through Claude to build it." Until then a new
 * account meant a session running scripts (Ruckus, Smuggler).
 *
 * Body: { companyId, grants: [{ email, name?, title?, role? }], copyDealFrom?: companyId }
 *
 * Nothing is emailed. The invite stays a separate, reviewed send from the
 * access panel ("Review & send invite"), and the logo is filed from the same
 * panel — the modal opens the new row there when this returns.
 * Same editor allowlist as every other terms write.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCompanyTermsEditor } from '@/lib/portal/companyTermsEditors'
import { grantCompanyPortalAccess, normalizeGrantInputs } from '@/lib/portal/grantCompanyAccess'
import { copyCompanyDeal } from '@/lib/portal/copyCompanyDeal'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const g = await requireCompanyTermsEditor()
  if ('error' in g) return g.error

  const body = (await req.json().catch(() => null)) as {
    companyId?: unknown
    grants?: unknown
    copyDealFrom?: unknown
  } | null

  const companyId = typeof body?.companyId === 'string' ? body.companyId : ''
  const company = companyId
    ? await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } })
    : null
  if (!company) return NextResponse.json({ error: 'Pick the production company.' }, { status: 400 })

  const raw = Array.isArray(body?.grants) ? body!.grants : []
  const grants = normalizeGrantInputs(raw.slice(0, 25), { defaultRole: 'HEAD_OF_PRODUCTION' })
  if (grants.length === 0) {
    return NextResponse.json({ error: 'Add at least one person with a real email address.' }, { status: 400 })
  }

  const copyFrom = typeof body?.copyDealFrom === 'string' && body.copyDealFrom ? body.copyDealFrom : null
  if (copyFrom === company.id) {
    return NextResponse.json({ error: 'Pick a different account to copy the deal from.' }, { status: 400 })
  }

  const granted = await grantCompanyPortalAccess(company.id, grants, { userId: g.user.id, accessId: null })
  const deal = copyFrom
    ? await copyCompanyDeal({ fromCompanyId: copyFrom, toCompanyId: company.id, byUserId: g.user.id })
    : null

  await prisma.auditLog.create({
    data: {
      userId: g.user.id,
      action: 'company_portal.created',
      entityType: 'Company',
      entityId: company.id,
      newValues: {
        companyName: company.name,
        people: grants.map((x) => ({ email: x.email, role: x.role })),
        accessIds: granted.created.map((c) => c.accessId),
        copiedDealFrom: copyFrom,
        rateIds: deal?.rateIds ?? [],
        discountIds: deal?.discountIds ?? [],
      },
    },
  })

  return NextResponse.json({
    ok: true,
    companyId: company.id,
    granted: granted.created.length,
    alreadyHad: granted.already.length,
    deal: deal && {
      rates: deal.rateIds.length,
      discounts: deal.discountIds.length,
      skippedRates: deal.skippedRates,
      skippedDiscounts: deal.skippedDiscounts,
    },
  })
}
