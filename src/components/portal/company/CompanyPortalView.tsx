/**
 * The account portal's body — one component, two doors.
 *
 * The client reaches it through /portal/company/[companyId] (session-gated,
 * counters bumped). HQ reaches the SAME markup through
 * /crm/portals/preview/company/[companyId] — Wes 2026-09-06: "a button in
 * our portal page for them and all others to 'see what they see'". Preview
 * differs in exactly four ways, all keyed on `preview`:
 *   - nothing is stamped (the caller never touches the access row),
 *   - document links go to the staff-gated equivalents, since the portal's
 *     own routes 404 without a client session,
 *   - job tiles open the HQ preview of that job rather than the live page,
 *   - every control that would write (share, add a colleague, save
 *     notifications, sign) is shown but inert.
 * Anything else that differed would make the preview a lie.
 *
 * Wes 2026-09-04 on the page itself: "accessible to Head of Production and
 * Executives … an overview: List of Jobs with basic info like Lead Contact,
 * and when clicked, Final invoices, Rental Agreements … Annual Agreements
 * would live above job tiles, a summary of terms with SirReel and a list of
 * services available at SirReel for their teams." The reading order IS that
 * sentence: terms first, then the shows, then what else we could be doing.
 */

import Link from 'next/link'
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  FileText,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react'
import type { CompanyPortalRole } from '@prisma/client'
import { COMPANY_PORTAL_ROLE_LABEL } from '@/lib/portal/companyPortal'
import { AskForAnnualButton } from '@/components/portal/company/AskForAnnualButton'
import {
  DEPARTMENT_PUBLIC_PATH,
  JOB_STATE_LABEL,
  type CompanyJobTile,
  type CompanyOverview,
} from '@/lib/portal/companyOverview'
import type { buildServiceCatalog } from '@/lib/portal/companyServices'
import type { CompanyPortalPersonRow } from '@/lib/portal/grantCompanyAccess'
import { PUBLIC_SITE_ORIGIN } from '@/lib/site/publicUrl'
import { PORTAL } from '@/lib/brand/portalTokens'
import { ShareWithTeamsButton } from '@/components/portal/company/ShareWithTeamsButton'
import { NotificationSettings, type NotificationPrefs } from '@/components/portal/company/NotificationSettings'
import { PeopleWithAccess } from '@/components/portal/company/PeopleWithAccess'

export interface CompanyPortalViewer {
  personName: string
  personEmail: string
  role: CompanyPortalRole
  title: string | null
}

export interface CompanyPortalViewProps {
  companyId: string
  viewer: CompanyPortalViewer
  overview: CompanyOverview
  services: Awaited<ReturnType<typeof buildServiceCatalog>>
  prefs: NotificationPrefs
  people: CompanyPortalPersonRow[]
  preview?: boolean
}

function fmtMoney(n: number | null): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

function fmtDay(d: Date | string | null): string {
  if (!d) return '—'
  const dt = typeof d === 'string' ? new Date(d) : d
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' })
}

function fmtRange(start: string | null, end: string | null): string {
  if (!start && !end) return 'Dates TBD'
  if (start && end) return `${fmtDay(start)} → ${fmtDay(end)}`
  return fmtDay(start || end)
}

const STATE_CHIP: Record<string, string> = {
  ON_JOB: 'bg-emerald-100 text-emerald-800',
  UPCOMING: 'bg-blue-100 text-blue-800',
  QUOTED: 'bg-amber-100 text-amber-900',
  HOLD: 'bg-zinc-200 text-zinc-700',
  WRAPPED: 'bg-zinc-100 text-zinc-600',
}

/** Where the portal's documents and pages live, for each door. */
export function companyPortalLinks(companyId: string, preview: boolean) {
  return {
    logo: preview ? `/api/crm/companies/${companyId}/logo` : `/api/portal/company/${companyId}/logo`,
    agreementPdf: (agreementId: string) =>
      preview ? `/api/agreements/company/${agreementId}` : `/api/portal/company/${companyId}/agreement/${agreementId}/pdf`,
    job: (jobId: string) =>
      preview ? `/crm/portals/preview/company/${companyId}/job/${jobId}` : `/portal/company/${companyId}/job/${jobId}`,
    home: preview ? `/crm/portals/preview/company/${companyId}` : `/portal/company/${companyId}`,
    signAnnual: `/portal/company/${companyId}/sign/annual`,
  }
}

function JobTile({ tile, href }: { tile: CompanyJobTile; href: string }) {
  return (
    <Link
      href={href}
      className="block bg-white border border-zinc-200 rounded-xl p-4 hover:border-zinc-400 transition-colors group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-zinc-500">{tile.jobCode}</span>
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATE_CHIP[tile.state] || STATE_CHIP.WRAPPED}`}
            >
              {JOB_STATE_LABEL[tile.state]}
            </span>
          </div>
          <div className="text-sm font-semibold text-zinc-900 mt-1 truncate">{tile.name}</div>
        </div>
        <ArrowRight className="w-4 h-4 text-zinc-300 group-hover:text-zinc-600 shrink-0 mt-0.5" />
      </div>

      <div className="mt-3 space-y-1 text-xs text-zinc-600">
        <div className="flex items-center gap-1.5">
          <CalendarDays className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          {fmtRange(tile.startDate, tile.endDate)}
        </div>
        <div className="flex items-center gap-1.5 truncate">
          <UserIcon className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          {tile.leadContactName ? (
            <>
              <span className="truncate">{tile.leadContactName}</span>
              {tile.leadContactRole && (
                <span className="text-zinc-400 shrink-0">· {tile.leadContactRole}</span>
              )}
            </>
          ) : (
            <span className="text-zinc-400">No lead contact yet</span>
          )}
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-zinc-100 flex items-center justify-between text-xs">
        <span className="text-zinc-500">
          {tile.invoicedTotal == null ? (
            'Not yet invoiced'
          ) : (
            <>
              Invoiced <span className="font-mono text-zinc-800">{fmtMoney(tile.invoicedTotal)}</span>
            </>
          )}
        </span>
        {tile.balanceDue > 0.005 ? (
          <span className="font-mono font-semibold text-amber-800">
            {fmtMoney(tile.balanceDue)} due
          </span>
        ) : tile.agreementSigned ? (
          <span className="inline-flex items-center gap-1 text-emerald-700">
            <BadgeCheck className="w-3.5 h-3.5" /> Signed
          </span>
        ) : (
          <span className="text-zinc-400">Agreement pending</span>
        )}
      </div>
    </Link>
  )
}

/**
 * Wes 2026-09-05: "widen the tiles when there are fewer than four." The
 * four-up grid was sized for Radical's eight deals; an account with one
 * deal was getting a quarter-width column and a five-line stack. Full
 * class strings on purpose — Tailwind only keeps what it can read.
 */
function rateGridClass(count: number): string {
  if (count <= 1) return 'grid-cols-1 max-w-md'
  if (count === 2) return 'grid-cols-1 sm:grid-cols-2 max-w-2xl'
  if (count === 3) return 'grid-cols-1 sm:grid-cols-3 max-w-3xl'
  return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 max-w-4xl'
}

export function CompanyPortalView({
  companyId,
  viewer,
  overview,
  services,
  prefs,
  people,
  preview = false,
}: CompanyPortalViewProps) {
  const { terms, active, past, totals } = overview
  const L = companyPortalLinks(companyId, preview)
  const inert = preview ? { 'aria-disabled': true, title: 'Disabled in preview' } : {}

  return (
    <div className="min-h-screen bg-[#F8F7F4]">
      {/* ── Masthead ─────────────────────────────────────────────────
          Wes 2026-09-04: "put their word logo and ours at the top of
          page. Make them similar in size and put either an '&' sign or
          '|' between" — then "use | instead of &". Its own white band
          ABOVE the dark row rather than inside it: on a dark ground their
          mark would have to be recoloured to white, which works for a bare
          SVG and turns a PNG with a background into a white block. Here
          every format reads as itself. No logo yet → their name in the
          display face, so the page is still theirs. */}
      <div className="w-full bg-white border-b border-zinc-200">
        {/* Wes 2026-09-04: "right justify SirReel and Left justify
            Radical. Make Radical image 10% smaller" … "Center the vertical
            line between word marks on the page." Three columns: their mark
            pinned left, ours pinned right, the rule in a fixed centre
            column — so it stays centred whatever the marks' widths. */}
        <div className="max-w-5xl mx-auto px-6 py-5 grid grid-cols-[1fr_auto_1fr] items-center gap-5">
          <div className="min-w-0 flex justify-start">
            {terms.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={L.logo}
                alt={overview.companyName}
                className="block h-6 sm:h-[29px] w-auto max-w-[38vw] sm:max-w-[220px] object-contain object-left"
              />
            ) : (
              <span className="font-display text-[24px] leading-none text-zinc-900 tracking-tight truncate">
                {overview.companyName}
              </span>
            )}
          </div>
          <span className="block w-px h-9 bg-zinc-300" aria-hidden />
          <div className="min-w-0 flex justify-end">
            {/* Ours carries a second line (STUDIO SERVICES), so at equal box
                height its wordmark reads smaller. A little taller so the two
                wordmarks sit at the same cap height. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/sirreel-logo.png" alt="SirReel" className="block h-8 sm:h-10 w-auto max-w-[38vw] sm:max-w-[220px] object-contain object-right" />
          </div>
        </div>
      </div>

      {/* ── Who's signed in ──────────────────────────────────────────
          Wes 2026-09-04: "Make the header a thinner row with name and
          email and position only." The masthead now carries the company;
          this strip carries the person. */}
      <header className="w-full" style={{ backgroundColor: PORTAL.dark }}>
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          {/* Wraps rather than truncates — the position is the part that
              would fall off the end, and it is the part that matters. */}
          <div className="min-w-0 text-[13px] text-white/85 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-semibold text-white">{viewer.personName}</span>
            <span className="text-white/40 hidden sm:inline">·</span>
            <span className="truncate max-w-full">{viewer.personEmail}</span>
            <span className="text-white/40 hidden sm:inline">·</span>
            <span style={{ color: PORTAL.gold }}>
              {viewer.title || COMPANY_PORTAL_ROLE_LABEL[viewer.role]}
            </span>
          </div>
          {/* A quiet link, not a button. Access is a 30-day magic-link
              session, so nobody signs in and out; this exists for a shared
              machine and should read like a footnote (Wes 2026-09-04). */}
          {preview ? (
            <span className="text-[11px] text-white/45 shrink-0">Sign out</span>
          ) : (
            <form action="/api/portal/auth/signout" method="POST" className="shrink-0">
              <button type="submit" className="text-[11px] text-white/45 hover:text-white/80 underline-offset-2 hover:underline">
                Sign out
              </button>
            </form>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-10">
        {/* ── Your rates ───────────────────────────────────────────────
            Wes 2026-09-04: standing discounts sit at the TOP. It is the
            fact an executive opens this page to confirm, and burying it
            under the paperwork would be answering the second question
            first. Rendered only when the account actually has one — an
            empty "Your rates" heading reads as a deal that fell through. */}
        {(terms.discounts.length > 0 || terms.negotiatedRates.length > 0) && (
          <section>
            {/* Wes 2026-09-04: 'Call it "Your deals with SirReel"'. Two
                kinds of deal, one section: a negotiated RATE prints as the
                price ("$125 /day · Cargo Van w/ Liftgate") and a standing
                DISCOUNT prints as the percent — the same split the quote
                itself makes, so the portal and the paperwork agree. */}
            {/* Wes 2026-09-04: 'have it say "your deals with (S) logo" and
                center it.' The S mark stands in for the word; the section
                is centred as a whole — heading, tiles, chips, footnote. */}
            <h2 className="flex items-center justify-center gap-2 text-[11px] uppercase font-semibold tracking-[1.6px] text-zinc-500 mb-4">
              <span>Your deals with</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/s-logo-black.png" alt="SirReel" className="h-[18px] w-auto inline-block" />
              <span className="text-zinc-400 normal-case tracking-normal font-normal">(Confidential)</span>
            </h2>

            {/* Wes 2026-09-04: "keep % tiles at top, individual unit rates
                much smaller and lined up left to right underneath." The
                percentages are the headline; a unit rate is a fact for the
                coordinator building the order. */}
            {/* Two across from the smallest screen up (Wes: "stack the 40%
                side by side"); three when the account has three+. */}
            {terms.discounts.length > 0 && (
              <div className="grid grid-cols-2 gap-3 max-w-4xl mx-auto">
                {terms.discounts.map((d) => (
                  <a
                    key={d.id}
                    href={`${PUBLIC_SITE_ORIGIN}${d.departmentKey ? DEPARTMENT_PUBLIC_PATH[d.departmentKey] || '/vehicles' : '/vehicles'}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block bg-white border border-zinc-200 rounded-xl px-6 py-5 hover:border-zinc-400 transition-colors"
                  >
                    <div className="text-[44px] leading-none font-medium tracking-tight text-zinc-900 tabular-nums">
                      {d.percentOff}
                      <span className="text-[26px] font-normal text-zinc-500 ml-0.5">% off</span>
                    </div>
                    <div className="mt-2 text-[17px] font-normal text-zinc-800 leading-snug">{d.label}</div>
                    {d.conditions && (
                      <div className="text-xs text-zinc-500 mt-1.5 leading-relaxed">{d.conditions}</div>
                    )}
                    {d.expiryDate && (
                      <div className="text-[11px] text-zinc-400 mt-1.5">Through {fmtDay(d.expiryDate)}</div>
                    )}
                  </a>
                ))}
              </div>
            )}

            {/* A grid, not a wrapping row: every tile the same width, rows
                aligned, no orphan floating in the last row (Wes 2026-09-04:
                "make all tiles the same width for cleaner spacing"). Four
                across on a desk, one column on a phone — two-across with a
                thumbnail wrapped every name onto three lines. */}
            {terms.negotiatedRates.length > 0 && (
              <div className={`grid gap-2 mx-auto ${rateGridClass(terms.negotiatedRates.length)} ${terms.discounts.length > 0 ? 'mt-3' : ''}`}>
                {terms.negotiatedRates.map((r) => (
                  <a
                    key={r.id}
                    href={`${PUBLIC_SITE_ORIGIN}${r.href}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 bg-white border border-zinc-200 rounded-lg pl-2 pr-3 py-2 min-h-[60px] hover:border-zinc-400 transition-colors"
                  >
                    {/* Wes 2026-09-04: "should we add images by items? Vehicles
                        etc?" — the catalog photo, when the vehicle has one. */}
                    {r.photoPath && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.photoPath}
                        alt=""
                        className="block h-11 w-16 rounded-md object-cover bg-zinc-100 shrink-0"
                      />
                    )}
                    <div className="min-w-0">
                    <div className="flex items-baseline gap-x-2 flex-wrap">
                      <span className="text-[17px] font-medium text-zinc-900 tabular-nums leading-none">
                        ${r.dailyRate.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                        <span className="text-[12px] font-normal text-zinc-500">/day</span>
                      </span>
                      <span className="text-[13px] text-zinc-700 leading-snug">{r.label}</span>
                      {r.weeklyRate != null && (
                        <span className="text-[11px] text-zinc-400">
                          · ${r.weeklyRate.toLocaleString('en-US', { maximumFractionDigits: 0 })}/wk
                        </span>
                      )}
                    </div>
                    {/* Wes 2026-09-04: 'a small font "regularly $450" or whatever
                        regular price under unit prices.' Only when the deal
                        actually beats list — a "regularly" that isn't lower
                        would advertise the opposite of a deal. */}
                    {r.listDailyRate != null && r.listDailyRate > r.dailyRate && (
                      <div className="text-[11px] text-zinc-400 mt-1 tabular-nums">
                        regularly ${r.listDailyRate.toLocaleString('en-US', { maximumFractionDigits: 0 })}/day
                      </div>
                    )}
                    {/* Wes 2026-09-05: "as long as the client rents longer than
                        5 consecutive days in one booking, the weekly rate
                        applies" — say so, so the day rate never looks like
                        the whole deal and the weekly never looks optional. */}
                    {r.weeklyRate != null && r.weeklyCap != null && (
                      <div className="text-[11px] text-zinc-400 mt-0.5">
                        weekly rate on rentals over {r.weeklyCap} consecutive days
                      </div>
                    )}
                    </div>
                  </a>
                ))}
              </div>
            )}
            <p className="text-[11px] text-zinc-400 mt-3 text-center">
              Applied automatically to every order your teams place. If a quote doesn&apos;t
              reflect these, tell your rep before you approve it.
            </p>
          </section>
        )}

        {/* ── Terms with SirReel — above the job tiles, per the brief ─── */}
        <section>
          <h2 className="text-[11px] uppercase font-semibold tracking-[1.6px] text-zinc-500 mb-3">
            Your terms with SirReel
          </h2>

          <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
            {/* Annual agreement — the headline of the block. */}
            <div className="p-5 border-b border-zinc-100">
              {terms.annual ? (
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                      <ShieldCheck className="w-3.5 h-3.5" /> Annual agreement active
                    </div>
                    <div className="text-sm font-semibold text-zinc-900 mt-2">
                      {terms.annual.title || terms.annual.originalFilename}
                    </div>
                    <p className="text-xs text-zinc-600 mt-1 leading-relaxed max-w-[62ch]">
                      Every show your company books runs under this agreement. Each job is
                      confirmed with a one-page addendum that logs it under the annual — nobody
                      re-signs the full agreement per show.
                      {terms.standingLcdw === 'ACCEPTED' &&
                        ' Damage waiver (LCDW) is accepted for all fleet vehicle rentals under it.'}
                      {terms.standingLcdw === 'DECLINED' &&
                        ' Damage waiver (LCDW) is declined for all fleet vehicle rentals under it.'}
                    </p>
                    <div className="text-xs text-zinc-500 mt-2 font-mono">
                      {fmtDay(terms.annual.effectiveDate)} → {fmtDay(terms.annual.expiryDate)}
                      {terms.annual.signerName && (
                        <span className="font-sans"> · signed by {terms.annual.signerName}</span>
                      )}
                    </div>
                  </div>
                  <a
                    href={L.agreementPdf(terms.annual.companyAgreementId)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg text-white shrink-0"
                    style={{ backgroundColor: PORTAL.gold }}
                  >
                    <FileText className="w-4 h-4" /> Read the agreement
                  </a>
                </div>
              ) : terms.pendingAnnual ? (
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800 bg-amber-50 px-2 py-0.5 rounded">
                      <FileText className="w-3.5 h-3.5" /> Annual agreement — ready to sign
                    </div>
                    <div className="text-sm font-semibold text-zinc-900 mt-2">{terms.pendingAnnual.title}</div>
                    <p className="text-xs text-zinc-600 mt-1 leading-relaxed max-w-[62ch]">
                      Sign the full agreement once for the year. After that, each show is confirmed
                      with a one-page addendum that logs it under the annual — your coordinators never
                      re-sign the whole thing. You&apos;ll choose the damage-waiver (LCDW) election for
                      the account as part of signing.
                    </p>
                    <div className="text-xs text-zinc-500 mt-2 font-mono">
                      {fmtDay(terms.pendingAnnual.effectiveDate)} → {fmtDay(terms.pendingAnnual.expiryDate)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={L.agreementPdf(terms.pendingAnnual.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-zinc-300 text-zinc-800 hover:border-zinc-500"
                    >
                      <FileText className="w-4 h-4" /> Read
                    </a>
                    {preview ? (
                      <span
                        {...inert}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg text-white opacity-60 cursor-not-allowed"
                        style={{ backgroundColor: PORTAL.gold }}
                      >
                        Sign the annual agreement <ArrowRight className="w-4 h-4" />
                      </span>
                    ) : (
                      <Link
                        href={L.signAnnual}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg text-white"
                        style={{ backgroundColor: PORTAL.gold }}
                      >
                        Sign the annual agreement <ArrowRight className="w-4 h-4" />
                      </Link>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="text-sm font-semibold text-zinc-900">Per-job rental agreement</div>
                  <p className="text-xs text-zinc-600 mt-1 leading-relaxed max-w-[62ch]">
                    Your account signs SirReel&apos;s rental agreement per show — each job&apos;s
                    coordinator signs it in their own job portal. If you&apos;d rather sign once for
                    the year, an executive here signs an annual agreement and every show after that
                    is confirmed with a one-page addendum.
                  </p>
                  {/* The sentence used to end "ask your rep about an annual
                      agreement" and stop there. Now the ask is a button, and
                      it lands in the desk's queue instead of an inbox. */}
                  <AskForAnnualButton
                    companyId={companyId}
                    requestedAt={terms.annualRequestedAt ? terms.annualRequestedAt.toString() : null}
                    preview={!!preview}
                  />
                </div>
              )}
            </div>

            {/* Negotiated terms, when the account has any recorded. */}
            {terms.negotiatedSummary && (
              <div className="p-5 border-b border-zinc-100">
                <div className="text-[11px] uppercase font-semibold tracking-wider text-zinc-500">
                  Negotiated terms
                </div>
                <p className="text-sm text-zinc-800 mt-1.5 whitespace-pre-wrap leading-relaxed">
                  {terms.negotiatedSummary}
                </p>
                {terms.negotiatedActiveAsOf && (
                  <div className="text-xs text-zinc-500 mt-1.5">
                    In effect since {fmtDay(terms.negotiatedActiveAsOf)}
                  </div>
                )}
              </div>
            )}

            {/* The standing facts. */}
            <dl className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-zinc-100">
              <Fact label="Open balance" value={fmtMoney(totals.openBalance)} emphasis={totals.openBalance > 0.005} />
              <Fact label="Active shows" value={String(totals.activeJobs)} />
              <Fact
                label="Insurance on file"
                value={
                  terms.coiOnFile
                    ? terms.coiExpiry
                      ? `Through ${fmtDay(terms.coiExpiry)}`
                      : 'Yes'
                    : 'Per job'
                }
              />
              <Fact
                label="Your rep"
                value={terms.accountRep?.name || 'SirReel team'}
                href={terms.accountRep ? `mailto:${terms.accountRep.email}` : undefined}
              />
            </dl>
          </div>

          {/* Other filed masters — the record, not the coverage. */}
          {terms.filedAgreements.filter((a) => a.id !== terms.annual?.companyAgreementId).length > 0 && (
            <details className="mt-3 group">
              <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-800 select-none">
                Other agreements on file (
                {terms.filedAgreements.filter((a) => a.id !== terms.annual?.companyAgreementId).length})
              </summary>
              <div className="mt-2 space-y-1.5">
                {terms.filedAgreements
                  .filter((a) => a.id !== terms.annual?.companyAgreementId)
                  .map((a) => (
                    <a
                      key={a.id}
                      href={L.agreementPdf(a.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 bg-white border border-zinc-200 rounded-lg px-3 py-2 text-xs hover:border-zinc-400"
                    >
                      <FileText className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                      <span className="text-zinc-800 truncate flex-1">{a.title}</span>
                      <span className="text-zinc-400 font-mono shrink-0">
                        {a.effectiveDate ? fmtDay(a.effectiveDate) : '—'}
                      </span>
                      {!a.current && <span className="text-zinc-400 shrink-0">expired</span>}
                    </a>
                  ))}
              </div>
            </details>
          )}
        </section>

        {/* ── Shows ────────────────────────────────────────────────────── */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-[11px] uppercase font-semibold tracking-[1.6px] text-zinc-500">
              Current shows
            </h2>
            <span className="text-xs text-zinc-400 font-mono">{active.length}</span>
          </div>
          {active.length === 0 ? (
            <div className="bg-white border border-zinc-200 rounded-xl p-6 text-sm text-zinc-500">
              Nothing running right now. New shows appear here as soon as your team books them.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {active.map((t) => (
                <JobTile key={t.id} tile={t} href={L.job(t.id)} />
              ))}
            </div>
          )}
        </section>

        {past.length > 0 && (
          <section>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-[11px] uppercase font-semibold tracking-[1.6px] text-zinc-500">
                Wrapped
              </h2>
              <span className="text-xs text-zinc-400 font-mono">{past.length}</span>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {past.map((t) => (
                <JobTile key={t.id} tile={t} href={L.job(t.id)} />
              ))}
            </div>
          </section>
        )}

        {/* ── Services ─────────────────────────────────────────────────── */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-[11px] uppercase font-semibold tracking-[1.6px] text-zinc-500">
              What SirReel can do for your teams
            </h2>
            <ShareWithTeamsButton
              companyId={companyId}
              companyName={overview.companyName}
              preview={preview}
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {services.lines.map((line) => (
              <a
                key={line.key}
                href={`${PUBLIC_SITE_ORIGIN}${line.href}`}
                target="_blank"
                rel="noreferrer"
                className="block bg-white border border-zinc-200 rounded-xl p-4 hover:border-zinc-400 transition-colors"
              >
                <div className="text-sm font-semibold text-zinc-900">{line.name}</div>
                <p className="text-xs text-zinc-600 mt-1 leading-relaxed">{line.blurb}</p>
                {line.examples.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {line.examples.map((ex) => (
                      <span
                        key={ex}
                        className="text-[10px] bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded"
                      >
                        {ex}
                      </span>
                    ))}
                  </div>
                )}
              </a>
            ))}
          </div>
        </section>

        {/* ── People with access ───────────────────────────────────────
            Wes 2026-09-06: "even though there is no password, only Ding
            Ding can currently access and if she wants to add people she
            can do so in her portal." The list is the answer to "who else
            can see this"; the form is the one thing they can do about it. */}
        <section>
          <h2 className="text-[11px] uppercase font-semibold tracking-[1.6px] text-zinc-500 mb-3">
            People with access
          </h2>
          <PeopleWithAccess companyId={companyId} initial={people} preview={preview} />
        </section>

        {/* ── Notifications ────────────────────────────────────────────── */}
        <section>
          <h2 className="text-[11px] uppercase font-semibold tracking-[1.6px] text-zinc-500 mb-3">
            Keep me posted
          </h2>
          <NotificationSettings companyId={companyId} initial={prefs} preview={preview} />
        </section>
      </main>

      <footer className="max-w-5xl mx-auto px-6 pb-10 text-xs text-zinc-400">
        Questions about this account?{' '}
        {terms.accountRep ? (
          <a href={`mailto:${terms.accountRep.email}`} className="underline text-zinc-600">
            {terms.accountRep.name}
          </a>
        ) : (
          <a href="mailto:info@sirreel.com" className="underline text-zinc-600">
            info@sirreel.com
          </a>
        )}{' '}
        · SirReel Studio Services
      </footer>
    </div>
  )
}

function Fact({
  label,
  value,
  emphasis,
  href,
}: {
  label: string
  value: string
  emphasis?: boolean
  href?: string
}) {
  const body = (
    <>
      <dt className="text-[10px] uppercase font-semibold tracking-wider text-zinc-400">{label}</dt>
      <dd
        className={`text-sm mt-1 truncate ${emphasis ? 'font-mono font-semibold text-amber-800' : 'text-zinc-900'}`}
      >
        {value}
      </dd>
    </>
  )
  return (
    <div className="px-4 py-3.5 min-w-0">
      {href ? (
        <a href={href} className="block hover:opacity-70">
          {body}
        </a>
      ) : (
        body
      )}
    </div>
  )
}
