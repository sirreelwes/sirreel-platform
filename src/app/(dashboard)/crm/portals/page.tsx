/**
 * /crm/portals — Company Portals: every client with an account portal.
 *
 * Wes 2026-09-04: "Is there a tab somewhere for this portal?" — there
 * wasn't. Then: "Rename … 'Company Portals' and make each one start
 * collapsed with basically a word mark and a couple of icons 'Annual
 * Agreement' (green showing on file) 'COI' (maybe red if expired) and
 * then drop down to open and inspect. Only Wes and Jose and Dani can make
 * changes to terms etc."
 *
 * One collapsed row per company with at least one grant. The chips answer
 * the two questions a glance should: is the paper in place, and is the
 * insurance current. Open a row for the rates and access panels — the
 * same components the company page carries, so the terms are edited from
 * here without a detour. Editing is gated by the named allowlist
 * (companyTermsEditors.ts), enforced on the write routes as well.
 */

import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { Building2 } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { findCompanyAnnualCoverage } from '@/lib/orders/annualCoverage'
import { canEditCompanyTerms } from '@/lib/portal/companyTermsEditors'
import { CompanyDiscountsPanel } from '@/components/crm/CompanyDiscountsPanel'
import { CompanyPortalAccessPanel } from '@/components/crm/CompanyPortalAccessPanel'
import { CompanyPortalRow, type ChipTone } from '@/components/crm/CompanyPortalRow'

export const dynamic = 'force-dynamic'

function fmtDay(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/**
 * COI chip. `Company.coiOnFile` + `coiExpiry` are the account-level facts
 * (the annual cert that carries forward to jobs). Expired reads RED even
 * when the flag is still on — a lapsed cert is the thing to notice.
 */
function coiChip(coiOnFile: boolean, coiExpiry: Date | null, now: Date): { tone: ChipTone; label: string } {
  if (coiExpiry && coiExpiry.getTime() < now.getTime()) {
    return { tone: 'bad', label: `COI expired ${fmtDay(coiExpiry)}` }
  }
  if (coiOnFile && coiExpiry) return { tone: 'good', label: `COI through ${fmtDay(coiExpiry)}` }
  if (coiOnFile) return { tone: 'good', label: 'COI on file' }
  return { tone: 'neutral', label: 'COI per job' }
}

export default async function CompanyPortalsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) redirect('/login')
  const canEdit = canEditCompanyTerms(session.user.email)
  const now = new Date()

  const companies = await prisma.company.findMany({
    where: { portalAccesses: { some: {} } },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      logoUrl: true,
      coiOnFile: true,
      coiExpiry: true,
      portalAccesses: {
        where: { revokedAt: null },
        select: { id: true, invitedAt: true },
      },
    },
  })

  const rows = await Promise.all(
    companies.map(async (c) => {
      const annual = await findCompanyAnnualCoverage(c.id)
      return {
        ...c,
        annualChip: annual
          ? { tone: 'good' as ChipTone, label: annual.expiryDate ? `Annual through ${fmtDay(annual.expiryDate)}` : 'Annual agreement' }
          : { tone: 'neutral' as ChipTone, label: 'Per-job agreement' },
        coiChip: coiChip(c.coiOnFile, c.coiExpiry, now),
        peopleCount: c.portalAccesses.length,
        uninvited: c.portalAccesses.filter((a) => !a.invitedAt).length,
      }
    }),
  )

  return (
    <div className="max-w-[1100px] mx-auto">
      <div className="flex items-end justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-lt-fg">Company Portals</h1>
          <p className="text-sm text-lt-fg2 mt-1 max-w-[70ch]">
            Clients whose executives see their whole account — shows, invoices, agreements and
            standing deals. Open a company to inspect or change its terms.
            {!canEdit && ' Changes here are made by Wes, Dani or Jose.'}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-8 text-center">
          <Building2 className="w-6 h-6 text-lt-fg3 mx-auto mb-2" />
          <p className="text-sm text-lt-fg2">
            No client has a portal yet. Open a company under Clients and use &ldquo;Account portal
            access&rdquo; to add their executives.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((c) => (
            <CompanyPortalRow
              key={c.id}
              companyId={c.id}
              name={c.name}
              hasLogo={!!c.logoUrl}
              annual={c.annualChip}
              coi={c.coiChip}
              peopleCount={c.peopleCount}
              uninvited={c.uninvited}
            >
              <CompanyDiscountsPanel companyId={c.id} canEdit={canEdit} />
              <CompanyPortalAccessPanel
                companyId={c.id}
                companyName={c.name}
                hasLogo={!!c.logoUrl}
                canEdit={canEdit}
              />
            </CompanyPortalRow>
          ))}
        </div>
      )}
    </div>
  )
}
