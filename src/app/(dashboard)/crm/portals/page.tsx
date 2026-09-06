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
import { Building2, Eye, Link2, Truck, Users } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { findCompanyAnnualCoverage } from '@/lib/orders/annualCoverage'
import { canEditCompanyTerms } from '@/lib/portal/companyTermsEditors'
import { CompanyDiscountsPanel } from '@/components/crm/CompanyDiscountsPanel'
import { CompanyPortalAccessPanel } from '@/components/crm/CompanyPortalAccessPanel'
import { CompanyPortalRow, type ChipTone } from '@/components/crm/CompanyPortalRow'
import { PortalsTabs } from '@/components/crm/PortalsTabs'
import { JobPortalRow, type JobPortalJobProps } from '@/components/crm/JobPortalRow'
import { VendorAccountLinkButton } from '@/components/crm/VendorAccountLinkButton'
import { VendorPartnerPanel } from '@/components/crm/VendorPartnerPanel'

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

  // Vendor portals: one link per sub-rental the vendor was sent.
  const vendorPortals = await prisma.subRental.findMany({
    where: { vendorToken: { not: null } },
    orderBy: { vendorTokenMintedAt: 'desc' },
    take: 40,
    select: {
      id: true,
      status: true,
      vendorTokenMintedAt: true,
      vendorNotifiedAt: true,
      vendorViewedAt: true,
      vendorViewCount: true,
      vendorHoldRequestedAt: true,
      vendorConfirmedAt: true,
      vendorDeclinedAt: true,
      driverName: true,
      driverToken: true,
      driverViewedAt: true,
      driverAckedAt: true,
      logisticsUpdatedAt: true,
      vendor: { select: { name: true } },
      subcontractedVehicle: { select: { name: true } },
      order: { select: { orderNumber: true, job: { select: { id: true, jobCode: true, name: true } } } },
      job: { select: { id: true, jobCode: true, name: true } },
    },
  })

  // Jobs pane: every order with at least one portal link, grouped by job,
  // with what the portal currently shows (releases live on the order).
  const SIGNED = ['SIGNED_BASELINE', 'SIGNED_NEGOTIATED', 'SIGNED_OFFLINE']
  const ordersWithPortals = await prisma.order.findMany({
    where: { portalAccesses: { some: {} } },
    orderBy: { updatedAt: 'desc' },
    take: 80,
    select: {
      id: true,
      orderNumber: true,
      quoteSentAt: true,
      job: { select: { id: true, jobCode: true, name: true, company: { select: { name: true } } } },
      signedAgreements: { select: { status: true, coveredByCompanyAgreementId: true, coveredByAgreementId: true } },
      invoices: { where: { OR: [{ status: { in: ['SENT', 'PARTIAL', 'PAID'] } }, { preSentAt: { not: null } }] }, select: { id: true } },
      portalAccesses: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, contactId: true, createdAt: true, revokedAt: true, magicLinkExpiresAt: true, lastAccessedAt: true, accessCount: true,
          contact: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
  })
  const jobsMap = new Map<string, JobPortalJobProps>()
  for (const o of ordersWithPortals) {
    if (!o.job) continue
    const ra = o.signedAgreements.find((a) => true)
    const agreement: JobPortalJobProps['orders'][number]['agreement'] = !ra
      ? 'none'
      : SIGNED.includes(ra.status)
        ? 'signed'
        : ra.coveredByCompanyAgreementId || ra.coveredByAgreementId
          ? 'covered'
          : ra.status === 'PORTAL_GENERATED'
            ? 'none'
            : 'released'
    const entry = jobsMap.get(o.job.id) ?? {
      jobId: o.job.id, jobCode: o.job.jobCode, jobName: o.job.name || o.job.jobCode,
      companyName: o.job.company?.name ?? null, orders: [], canEdit,
    }
    entry.orders.push({
      orderId: o.id,
      orderNumber: o.orderNumber,
      quoteSent: !!o.quoteSentAt,
      agreement,
      invoicesVisible: o.invoices.length,
      people: o.portalAccesses.filter((a) => !a.revokedAt).map((a) => ({
        accessId: a.id, contactId: a.contactId,
        name: `${a.contact.firstName} ${a.contact.lastName}`.trim(), email: a.contact.email,
        sentAt: a.createdAt.toISOString(), lastAccessedAt: a.lastAccessedAt?.toISOString() ?? null,
        accessCount: a.accessCount, expired: a.magicLinkExpiresAt.getTime() < now.getTime(),
      })),
    })
    jobsMap.set(o.job.id, entry)
  }
  const jobRows = [...jobsMap.values()]

  // Clients pane: people who have actually signed in to a portal.
  const sessions = await prisma.personSession.findMany({
    where: { magicLinkUsedAt: { not: null } },
    orderBy: { lastAccessedAt: 'desc' },
    take: 200,
    select: {
      lastAccessedAt: true, accessCount: true, createdAt: true,
      person: { select: { id: true, firstName: true, lastName: true, email: true, _count: { select: { jobContacts: true, companyPortalAccesses: true } } } },
    },
  })
  const peopleMap = new Map<string, { id: string; name: string; email: string; lastSeen: Date | null; signIns: number; jobs: number; companies: number }>()
  for (const s of sessions) {
    const cur = peopleMap.get(s.person.id)
    const seen = s.lastAccessedAt ?? s.createdAt
    if (cur) { cur.signIns += 1; if (!cur.lastSeen || seen > cur.lastSeen) cur.lastSeen = seen; continue }
    peopleMap.set(s.person.id, {
      id: s.person.id, name: `${s.person.firstName} ${s.person.lastName}`.trim(), email: s.person.email,
      lastSeen: seen, signIns: 1, jobs: s.person._count.jobContacts, companies: s.person._count.companyPortalAccesses,
    })
  }
  const clientPeople = [...peopleMap.values()]

  // Vendor ACCOUNTS: one row per partner with anything on the books.
  const vendorAccounts = await prisma.vendor.findMany({
    where: { isActive: true, subRentals: { some: {} } },
    orderBy: { name: 'asc' },
    select: {
      id: true, name: true, contactName: true, email: true, phone: true, lotAddress: true,
      logoUrl: true, logoSvg: true,
      portalToken: true, portalTokenMintedAt: true, portalViewedAt: true, portalViewCount: true,
      _count: { select: { subRentals: true, subcontractedVehicles: true } },
      agreements: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1, select: { title: true, signedAt: true, signerName: true, createdAt: true } },
      subcontractedVehicles: {
        where: { rateProposedAt: { not: null } },
        select: { id: true, name: true, listDailyRate: true, listWeeklyRate: true, listMonthlyRate: true, proposedDailyRate: true, proposedWeeklyRate: true, proposedMonthlyRate: true, rateProposedAt: true, rateProposalNote: true },
      },
    },
  })
  const dec = (d: unknown) => (d == null ? null : Number(d))

  const fmtStamp = (d: Date | null) =>
    d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null

  return (
    <div className="max-w-[1100px] mx-auto">
      <div className="flex items-end justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-lt-fg">Portals</h1>
          <p className="text-sm text-lt-fg2 mt-1 max-w-[70ch]">
            Every link we hand out, by kind — who has it, whether they&apos;ve opened it, and where
            to change what they see.
            {!canEdit && ' Company terms here are changed by Wes, Dani or Jose.'}
          </p>
        </div>
      </div>

      <PortalsTabs
        counts={{ company: rows.length, job: jobRows.length, client: clientPeople.length, vendor: vendorPortals.length }}
        panes={{
          company: (
            <div>
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
          ),
          job: (
            <div className="space-y-3">
              {jobRows.length === 0 ? (
                <div className="bg-lt-card border border-lt-hairline rounded-xl p-8 text-center">
                  <Link2 className="w-6 h-6 text-lt-fg3 mx-auto mb-2" />
                  <p className="text-sm text-lt-fg2">No job portal links have been issued yet.</p>
                </div>
              ) : (
                jobRows.map((j) => <JobPortalRow key={j.jobId} {...j} />)
              )}
            </div>
          ),
          client: (
            <div>
              {clientPeople.length === 0 ? (
                <div className="bg-lt-card border border-lt-hairline rounded-xl p-8 text-center">
                  <Users className="w-6 h-6 text-lt-fg3 mx-auto mb-2" />
                  <p className="text-sm text-lt-fg2">Nobody has signed in to a portal yet.</p>
                </div>
              ) : (
                <div className="bg-lt-card border border-lt-hairline rounded-xl divide-y divide-lt-hairline">
                  {clientPeople.map((c) => (
                    <div key={c.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4">
                      <div className="min-w-0 flex-1">
                        <Link href={`/crm/people/${c.id}`} className="text-sm font-medium text-lt-fg hover:underline">{c.name || c.email}</Link>
                        <div className="text-xs text-lt-fg2 truncate">{c.email}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                        <span className="px-2 py-1 rounded bg-chip-good-bg text-chip-good-fg">last seen {fmtStamp(c.lastSeen)}</span>
                        <span className="px-2 py-1 rounded bg-chip-neutral-bg text-chip-neutral-fg">{c.signIns} sign-in{c.signIns === 1 ? '' : 's'}</span>
                        <span className="px-2 py-1 rounded bg-chip-neutral-bg text-chip-neutral-fg">{c.jobs} job{c.jobs === 1 ? '' : 's'}</span>
                        {c.companies > 0 && <span className="px-2 py-1 rounded bg-chip-neutral-bg text-chip-neutral-fg">{c.companies} company portal{c.companies === 1 ? '' : 's'}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ),
          vendor: (
            <div>
              {/* Partner ACCOUNT links — one per vendor, every job at once
                  (Wes 2026-09-05: "multiple jobs for the vendor to look at
                  as well as multiple vehicles"). The per-unit links follow. */}
              <h3 className="text-[11px] uppercase font-semibold tracking-[1.6px] text-lt-fg3 mb-3">
                Partner accounts · {vendorAccounts.length}
              </h3>
              <div className="bg-lt-card border border-lt-hairline rounded-xl divide-y divide-lt-hairline mb-8">
                {vendorAccounts.map((va) => (
                  <details key={va.id} className="group">
                  <summary className="list-none cursor-pointer px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 [&::-webkit-details-marker]:hidden">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-lt-fg truncate">
                        {va.name}
                        {va.subcontractedVehicles.length > 0 && <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-chip-warn-bg text-chip-warn-fg align-middle">{va.subcontractedVehicles.length} rate proposal{va.subcontractedVehicles.length === 1 ? '' : 's'}</span>}
                        {va.agreements[0] && !va.agreements[0].signedAt && <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-chip-warn-bg text-chip-warn-fg align-middle">agreement unsigned</span>}
                        {va.agreements[0]?.signedAt && <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-chip-good-bg text-chip-good-fg align-middle">agreement signed</span>}
                      </div>
                      <div className="text-xs text-lt-fg2 truncate">
                        {va._count.subcontractedVehicles} unit{va._count.subcontractedVehicles === 1 ? '' : 's'} on the roster · {va._count.subRentals} booking{va._count.subRentals === 1 ? '' : 's'}
                        {va.contactName ? ` · ${va.contactName}` : ''}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                      {va.portalToken ? (
                        <span className={`px-2 py-1 rounded ${va.portalViewedAt ? 'bg-chip-good-bg text-chip-good-fg' : 'bg-chip-warn-bg text-chip-warn-fg'}`}>
                          {va.portalViewedAt ? `opened ${fmtStamp(va.portalViewedAt)} (${va.portalViewCount}×)` : `link minted ${fmtStamp(va.portalTokenMintedAt)} · never opened`}
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded bg-chip-neutral-bg text-chip-neutral-fg">no account link yet</span>
                      )}
                      <Link href={`/crm/portals/preview/vendor-account/${va.id}`} className="border border-lt-hairline rounded-md px-2 py-1 text-lt-fg hover:text-black">
                        Preview
                      </Link>
                      {canEdit && <VendorAccountLinkButton vendorId={va.id} />}
                    </div>
                  </summary>
                  <div className="px-4 pb-4 border-t border-lt-hairline pt-3">
                    <VendorPartnerPanel
                      vendorId={va.id}
                      hasLogo={!!(va.logoSvg || va.logoUrl)}
                      agreement={va.agreements[0] ? { title: va.agreements[0].title, signedAt: va.agreements[0].signedAt?.toISOString() ?? null, signerName: va.agreements[0].signerName, uploadedAt: va.agreements[0].createdAt.toISOString() } : null}
                      proposals={va.subcontractedVehicles.map((u) => ({
                        unitId: u.id, unitName: u.name,
                        current: { daily: dec(u.listDailyRate), weekly: dec(u.listWeeklyRate), monthly: dec(u.listMonthlyRate) },
                        proposed: { daily: dec(u.proposedDailyRate), weekly: dec(u.proposedWeeklyRate), monthly: dec(u.proposedMonthlyRate) },
                        at: u.rateProposedAt!.toISOString(), note: u.rateProposalNote,
                      }))}
                      contact={{ name: va.contactName, email: va.email, phone: va.phone, lotAddress: va.lotAddress }}
                    />
                  </div>
                  </details>
                ))}
              </div>
              <h3 className="text-[11px] uppercase font-semibold tracking-[1.6px] text-lt-fg3 mb-3">
                Unit links · latest {vendorPortals.length}
              </h3>
      {/* ── Vendor portals ───────────────────────────────────────────
          Wes 2026-09-05: "Will Vendor portals also fold into that tab?"
          Yes. A partner's link for a sub-rental: sent, opened, acted. */}
      {vendorPortals.length === 0 ? (
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-8 text-center">
          <Truck className="w-6 h-6 text-lt-fg3 mx-auto mb-2" />
          <p className="text-sm text-lt-fg2">No vendor links have been issued yet.</p>
        </div>
      ) : (
        <div className="bg-lt-card border border-lt-hairline rounded-xl divide-y divide-lt-hairline">
          {vendorPortals.map((v) => {
            const job = v.order?.job ?? v.job
            const opened = !!v.vendorViewedAt
            const acted = !!v.vendorHoldRequestedAt
            return (
              <div key={v.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-lt-fg truncate">{v.vendor.name}</span>
                    {v.subcontractedVehicle?.name && <span className="text-xs text-lt-fg2 truncate">· {v.subcontractedVehicle.name}</span>}
                  </div>
                  <div className="text-xs text-lt-fg2 mt-0.5 truncate">
                    {job ? (
                      <Link href={`/jobs/${job.id}`} className="hover:underline">{job.name || job.jobCode}</Link>
                    ) : 'No job'}
                    {v.order?.orderNumber ? ` · ${v.order.orderNumber}` : ''}
                    {' · '}<span className="text-lt-fg3">{v.status.toLowerCase().replace(/_/g, ' ')}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 sm:shrink-0 text-[11px] font-semibold">
                  <span className="px-2 py-1 rounded bg-chip-neutral-bg text-chip-neutral-fg">
                    {v.vendorNotifiedAt ? `sent ${fmtStamp(v.vendorNotifiedAt)}` : `minted ${fmtStamp(v.vendorTokenMintedAt)}`}
                  </span>
                  <span className={`px-2 py-1 rounded ${opened ? 'bg-chip-good-bg text-chip-good-fg' : 'bg-chip-warn-bg text-chip-warn-fg'}`}>
                    {opened ? `opened ${fmtStamp(v.vendorViewedAt)} (${v.vendorViewCount}×)` : 'never opened'}
                  </span>
                  {v.vendorDeclinedAt ? (
                    <span className="px-2 py-1 rounded bg-chip-bad-bg text-chip-bad-fg">can&rsquo;t hold {fmtStamp(v.vendorDeclinedAt)}</span>
                  ) : v.vendorConfirmedAt ? (
                    <span className="px-2 py-1 rounded bg-chip-good-bg text-chip-good-fg">confirmed {fmtStamp(v.vendorConfirmedAt)}</span>
                  ) : acted ? (
                    <span className="px-2 py-1 rounded bg-chip-good-bg text-chip-good-fg">
                      hold requested {fmtStamp(v.vendorHoldRequestedAt)}
                    </span>
                  ) : null}
                  {v.driverName && (
                    <span
                      className={`px-2 py-1 rounded ${
                        v.driverAckedAt && !(v.logisticsUpdatedAt && v.driverAckedAt < v.logisticsUpdatedAt)
                          ? 'bg-chip-good-bg text-chip-good-fg'
                          : v.driverViewedAt
                            ? 'bg-chip-warn-bg text-chip-warn-fg'
                            : 'bg-chip-neutral-bg text-chip-neutral-fg'
                      }`}
                      title={v.driverName}
                    >
                      driver {v.driverAckedAt && !(v.logisticsUpdatedAt && v.driverAckedAt < v.logisticsUpdatedAt) ? 'confirmed' : v.driverViewedAt ? 'opened page' : v.driverToken ? 'page sent' : 'named'}
                    </span>
                  )}
                </div>
                {/* Wes 2026-09-05: see what the portal looks like for the vendor / the driver. */}
                <div className="flex items-center gap-3 sm:shrink-0 text-xs">
                  <Link href={`/crm/portals/preview/vendor/${v.id}`} className="inline-flex items-center gap-1 text-lt-fg2 hover:text-lt-fg">
                    <Eye className="w-3.5 h-3.5" /> Vendor view
                  </Link>
                  {v.driverName && (
                    <Link href={`/crm/portals/preview/driver/${v.id}`} className="inline-flex items-center gap-1 text-lt-fg2 hover:text-lt-fg">
                      <Eye className="w-3.5 h-3.5" /> Driver view
                    </Link>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
            </div>
          ),
        }}
      />
    </div>
  )
}
