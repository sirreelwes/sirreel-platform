/**
 * /crm/portals — every client with an account portal, in one place.
 *
 * Wes 2026-09-04: "Is there a tab somewhere for this portal?" There
 * wasn't — access lived only as a panel at the bottom of each company's
 * CRM page, so "who has one, and have we told them" meant opening
 * companies one at a time. This is the tab.
 *
 * One row per company with at least one grant (live or revoked). The
 * columns are the questions a rep actually asks: who's on it, have they
 * been invited, have they ever opened it, is it branded, what rates are
 * they on. Every row links to the company page, where the editing lives —
 * and — Wes 2026-09-04: "The tab for me should allow me to change the
 * terms for each dept and discount etc" — the same rates and access
 * panels the company page carries, inline, so the terms are edited from
 * here without a detour.
 *
 * Server component on the light staff shell (lt-* tokens).
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { Building2, ImageIcon, Percent } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { COMPANY_PORTAL_ROLE_LABEL } from '@/lib/portal/companyPortal'
import { CompanyDiscountsPanel } from '@/components/crm/CompanyDiscountsPanel'
import { CompanyPortalAccessPanel } from '@/components/crm/CompanyPortalAccessPanel'

export const dynamic = 'force-dynamic'

function fmt(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default async function AccountPortalsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) redirect('/login')
  // Same gate the CRM company page uses for these panels.
  const canEdit = (session.user as { role?: string }).role === 'ADMIN'

  const companies = await prisma.company.findMany({
    where: { portalAccesses: { some: {} } },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      logoUrl: true,
      portalAccesses: {
        orderBy: [{ revokedAt: 'asc' }, { grantedAt: 'desc' }],
        select: {
          id: true,
          role: true,
          title: true,
          invitedAt: true,
          lastAccessedAt: true,
          accessCount: true,
          revokedAt: true,
          person: { select: { firstName: true, lastName: true, email: true } },
        },
      },
      discounts: {
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { percentOff: 'desc' }],
        select: { percentOff: true, label: true },
      },
    },
  })

  return (
    <div className="max-w-[1100px] mx-auto">
      <div className="flex items-end justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-lt-fg">Account portals</h1>
          <p className="text-sm text-lt-fg2 mt-1 max-w-[70ch]">
            Clients whose executives can see their whole account — every show, invoices,
            agreements and standing rates. Grant access, upload a logo or enter rates from the
            company&apos;s page.
          </p>
        </div>
        <Link href="/crm" className="text-sm text-lt-fg2 hover:text-lt-fg shrink-0">
          All clients →
        </Link>
      </div>

      {companies.length === 0 ? (
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-8 text-center">
          <Building2 className="w-6 h-6 text-lt-fg3 mx-auto mb-2" />
          <p className="text-sm text-lt-fg2">
            No client has account access yet. Open a company under Clients and use
            &ldquo;Account portal access&rdquo; to add their executives.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {companies.map((c) => {
            const live = c.portalAccesses.filter((a) => !a.revokedAt)
            const uninvited = live.filter((a) => !a.invitedAt).length
            const opened = live.filter((a) => a.lastAccessedAt).length
            return (
              <details key={c.id} open className="group bg-lt-card border border-lt-hairline rounded-xl">
                <summary className="list-none cursor-pointer p-4 [&::-webkit-details-marker]:hidden">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-semibold text-lt-fg truncate">{c.name}</span>
                      {c.logoUrl ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-chip-good-bg text-chip-good-fg">
                          <ImageIcon className="w-3 h-3" /> logo
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-chip-neutral-bg text-chip-neutral-fg">
                          no logo
                        </span>
                      )}
                      {c.discounts.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-chip-warn-bg text-chip-warn-fg">
                          <Percent className="w-3 h-3" />
                          {c.discounts.map((d) => `${d.percentOff}% ${d.label}`).join(' · ')}
                        </span>
                      )}
                    </div>

                    <div className="mt-2 space-y-1">
                      {live.length === 0 && (
                        <div className="text-xs text-lt-fg3">All access revoked.</div>
                      )}
                      {live.map((a) => (
                        <div key={a.id} className="text-xs text-lt-fg2 flex items-center gap-2 flex-wrap">
                          <span className="text-lt-fg font-medium">
                            {a.person.firstName} {a.person.lastName}
                          </span>
                          <span className="text-lt-fg3">
                            {COMPANY_PORTAL_ROLE_LABEL[a.role]}
                            {a.title ? ` · ${a.title}` : ''}
                          </span>
                          <span className="text-lt-fg3">·</span>
                          <span>{a.person.email}</span>
                          <span className="text-lt-fg3">·</span>
                          <span className={a.invitedAt ? '' : 'text-chip-warn-fg'}>
                            {a.invitedAt ? `invited ${fmt(a.invitedAt)}` : 'not invited'}
                          </span>
                          <span className="text-lt-fg3">·</span>
                          <span>
                            {a.lastAccessedAt
                              ? `opened ${fmt(a.lastAccessedAt)} (${a.accessCount}×)`
                              : 'never opened'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="shrink-0 text-right text-xs text-lt-fg3">
                    <div className="text-lt-fg text-sm font-medium">
                      {live.length} {live.length === 1 ? 'person' : 'people'}
                    </div>
                    {uninvited > 0 && <div className="text-chip-warn-fg">{uninvited} to invite</div>}
                    <div>{opened} opened</div>
                    <Link href={`/crm/${c.id}`} className="block mt-1 text-lt-fg2 hover:text-lt-fg underline">
                      company page
                    </Link>
                  </div>
                </div>
                </summary>
                <div className="px-4 pb-4 space-y-4 border-t border-lt-hairline pt-4">
                  <CompanyDiscountsPanel companyId={c.id} canEdit={canEdit} />
                  <CompanyPortalAccessPanel
                    companyId={c.id}
                    companyName={c.name}
                    hasLogo={!!c.logoUrl}
                    canEdit={canEdit}
                  />
                </div>
              </details>
            )
          })}
        </div>
      )}
    </div>
  )
}
