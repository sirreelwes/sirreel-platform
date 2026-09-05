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

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { Building2, Link2 } from 'lucide-react'
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

  // Job portals: one link per order/contact. Newest first, capped — the
  // question is "who's active", not the whole history.
  const jobPortals = await prisma.portalAccess.findMany({
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: {
      id: true,
      createdAt: true,
      revokedAt: true,
      magicLinkExpiresAt: true,
      lastAccessedAt: true,
      accessCount: true,
      contact: { select: { firstName: true, lastName: true, email: true } },
      order: {
        select: {
          orderNumber: true,
          job: { select: { id: true, jobCode: true, name: true, company: { select: { name: true } } } },
        },
      },
    },
  })
  const fmtStamp = (d: Date | null) =>
    d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null

  return (
    <div className="max-w-[1100px] mx-auto">
      <div className="flex items-end justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-lt-fg">Portals</h1>
          <p className="text-sm text-lt-fg2 mt-1 max-w-[70ch]">
            Two kinds. <strong className="text-lt-fg">Company portals</strong> — executives who see
            their whole account. <strong className="text-lt-fg">Job portals</strong> — the paperwork
            link each show&apos;s contact gets. Both show who has opened what.
            {!canEdit && ' Company terms here are changed by Wes, Dani or Jose.'}
          </p>
        </div>
      </div>

      <h2 className="text-[11px] uppercase font-semibold tracking-[1.6px] text-lt-fg3 mb-3">
        Company portals · {rows.length}
      </h2>
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

      {/* ── Job portals ──────────────────────────────────────────────
          Wes 2026-09-05: "Should we fold Company Portals and Contact
          portals into one tab?" Yes — the question a rep asks is the same
          for both: did they get it, did they open it. */}
      <h2 className="text-[11px] uppercase font-semibold tracking-[1.6px] text-lt-fg3 mt-10 mb-3">
        Job portals · latest {jobPortals.length}
      </h2>
      {jobPortals.length === 0 ? (
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-8 text-center">
          <Link2 className="w-6 h-6 text-lt-fg3 mx-auto mb-2" />
          <p className="text-sm text-lt-fg2">No job portal links have been issued yet.</p>
        </div>
      ) : (
        <div className="bg-lt-card border border-lt-hairline rounded-xl divide-y divide-lt-hairline">
          {jobPortals.map((p) => {
            const job = p.order.job
            const dead = !!p.revokedAt || p.magicLinkExpiresAt.getTime() < now.getTime()
            const opened = !!p.lastAccessedAt
            return (
              <div key={p.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    {job ? (
                      <Link href={`/jobs/${job.id}`} className="text-sm font-medium text-lt-fg hover:underline truncate">
                        {job.name || job.jobCode}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium text-lt-fg">Order {p.order.orderNumber}</span>
                    )}
                    <span className="text-xs text-lt-fg3 font-mono shrink-0">{p.order.orderNumber}</span>
                  </div>
                  <div className="text-xs text-lt-fg2 mt-0.5 truncate">
                    {job?.company?.name ? `${job.company.name} · ` : ''}
                    {p.contact.firstName} {p.contact.lastName} · {p.contact.email}
                  </div>
                </div>
                <div className="flex items-center gap-2 sm:shrink-0 text-[11px] font-semibold">
                  <span className="px-2 py-1 rounded bg-chip-neutral-bg text-chip-neutral-fg">
                    sent {fmtStamp(p.createdAt)}
                  </span>
                  <span className={`px-2 py-1 rounded ${opened ? 'bg-chip-good-bg text-chip-good-fg' : 'bg-chip-warn-bg text-chip-warn-fg'}`}>
                    {opened ? `opened ${fmtStamp(p.lastAccessedAt)} (${p.accessCount}×)` : 'never opened'}
                  </span>
                  {dead && (
                    <span className="px-2 py-1 rounded bg-chip-neutral-bg text-chip-neutral-fg">
                      {p.revokedAt ? 'revoked' : 'link expired'}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
