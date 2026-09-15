/**
 * GET /api/paperwork/negotiated-agreements — every approved redlined
 * agreement on file, across all production companies, from BOTH registers.
 *
 * Wes, 2026-09-15: "create a section at bottom of paperwork page where we
 * file all approved redlined agreements for production companies."
 *
 * ── Why this reads two things ─────────────────────────────────────────
 * HQ records a negotiated agreement in two unconnected places, and both are
 * live:
 *
 *  1. `Company.negotiatedTerms*` — the standing-agreement registry behind
 *     /admin/negotiated-agreements. Read by lib/orders/signedAgreement.ts,
 *     the order agreement route and the job portal.
 *  2. `CompanyAgreement` with `autoCoverJobs` — the annual/negotiated master
 *     that actually papers a company's jobs, and the one the quote portal now
 *     serves in place of the baseline.
 *
 * Nothing keeps them in step. A company can be marked as having approved
 * negotiated terms while carrying no covering master — and that combination
 * is precisely what produced the 2026-09-15 email from Graduation Day
 * Productions asking why the quote portal still showed them our standard
 * agreement. A list that showed only one register would have looked fine.
 *
 * So each row reports both, and `gap` names the disagreement. This endpoint
 * is READ-ONLY and reconciles nothing: which register is right for a given
 * client is a human call, and quietly writing one from the other would be a
 * contract change made by a list view.
 *
 * `covering` is DERIVED per master via isCoverageCurrent, never read off the
 * flag, because auto-cover needs a current window as well as the opt-in —
 * showing the flag alone would render an expired 2025 master as active while
 * it quietly covers nothing.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isCoverageCurrent } from '@/lib/orders/annualCoverage'

export const dynamic = 'force-dynamic'

export type AgreementGap =
  /** Registry says terms are approved, but nothing is papering their jobs. */
  | 'registered-not-covering'
  /** A master papers their jobs, but the standing-terms registry is blank. */
  | 'covering-not-registered'
  | null

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const [registered, masters] = await Promise.all([
    prisma.company.findMany({
      where: { negotiatedTermsApprovedAt: { not: null } },
      select: {
        id: true,
        name: true,
        negotiatedTermsUrl: true,
        negotiatedTermsSummary: true,
        negotiatedTermsApprovedAt: true,
        negotiatedTermsApprovedBy: true,
        negotiatedTermsReviewDueDate: true,
      },
    }),
    prisma.companyAgreement.findMany({
      where: { deletedAt: null },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
      take: 1000,
      select: {
        id: true,
        companyId: true,
        company: { select: { name: true } },
        contractType: true,
        title: true,
        autoCoverJobs: true,
        deletedAt: true,
        effectiveDate: true,
        expiryDate: true,
        signerName: true,
        signedAt: true,
        standingLcdwDecision: true,
        originalFilename: true,
        createdAt: true,
      },
    }),
  ])

  const now = new Date()
  const byCompany = new Map<
    string,
    {
      companyId: string
      companyName: string | null
      registry: null | {
        approvedAt: string | null
        approvedBy: string | null
        url: string | null
        summary: string | null
        reviewDueDate: string | null
      }
      masters: Array<Record<string, unknown>>
      covering: boolean
    }
  >()

  const ensure = (id: string, name: string | null) => {
    if (!byCompany.has(id)) {
      byCompany.set(id, { companyId: id, companyName: name, registry: null, masters: [], covering: false })
    }
    const row = byCompany.get(id)!
    if (!row.companyName && name) row.companyName = name
    return row
  }

  for (const c of registered) {
    ensure(c.id, c.name).registry = {
      approvedAt: c.negotiatedTermsApprovedAt?.toISOString() ?? null,
      approvedBy: c.negotiatedTermsApprovedBy,
      url: c.negotiatedTermsUrl,
      summary: c.negotiatedTermsSummary,
      reviewDueDate: c.negotiatedTermsReviewDueDate?.toISOString() ?? null,
    }
  }

  for (const m of masters) {
    const row = ensure(m.companyId, m.company?.name ?? null)
    const covering = isCoverageCurrent(m, now)
    if (covering) row.covering = true

    let lapsed: 'expired' | 'not-yet' | null = null
    if (m.autoCoverJobs && !covering) {
      if (m.expiryDate && m.expiryDate.getTime() < now.getTime()) lapsed = 'expired'
      else if (m.effectiveDate && m.effectiveDate.getTime() > now.getTime()) lapsed = 'not-yet'
    }

    row.masters.push({
      id: m.id,
      contractType: m.contractType,
      title: m.title,
      autoCoverJobs: m.autoCoverJobs,
      covering,
      lapsed,
      effectiveDate: m.effectiveDate?.toISOString() ?? null,
      expiryDate: m.expiryDate?.toISOString() ?? null,
      signerName: m.signerName,
      signedAt: m.signedAt?.toISOString() ?? null,
      standingLcdwDecision: m.standingLcdwDecision,
      originalFilename: m.originalFilename,
      createdAt: m.createdAt.toISOString(),
    })
  }

  const companies = [...byCompany.values()]
    .map((row) => {
      let gap: AgreementGap = null
      if (row.registry && !row.covering) gap = 'registered-not-covering'
      else if (!row.registry && row.covering) gap = 'covering-not-registered'
      return { ...row, gap }
    })
    // Anything needing attention first, then alphabetical — this list is read
    // to find the account that is set up wrong, not to browse.
    .sort((a, b) => {
      if (!!a.gap !== !!b.gap) return a.gap ? -1 : 1
      return (a.companyName || '').localeCompare(b.companyName || '')
    })

  return NextResponse.json({
    companies,
    counts: {
      companies: companies.length,
      covering: companies.filter((c) => c.covering).length,
      gaps: companies.filter((c) => c.gap).length,
    },
  })
}
