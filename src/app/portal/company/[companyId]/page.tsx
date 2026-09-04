/**
 * /portal/company/[companyId] — the production company's account view.
 *
 * Wes 2026-09-04: "accessible to Head of Production and Executives at the
 * Production Company … an overview: List of Jobs with basic info like Lead
 * Contact, and when clicked, Final invoices, Rental Agreements … Annual
 * Agreements would live above job tiles, a summary of terms with SirReel
 * and a list of services available at SirReel for their teams."
 *
 * The reading order on the page IS that sentence, deliberately: terms
 * first (what this relationship runs on), then the shows, then what else
 * we could be doing for them. An executive opening this once a month is
 * answering "are we in good standing and what's running" — the terms block
 * answers the first half before they scroll.
 *
 * Authorization is `getCompanyPortalSession` and nothing else; see
 * src/lib/portal/companyPortal.ts for why a miss renders 404.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  FileText,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react'
import { getCompanyPortalSession, COMPANY_PORTAL_ROLE_LABEL } from '@/lib/portal/companyPortal'
import { buildCompanyOverview, JOB_STATE_LABEL, type CompanyJobTile } from '@/lib/portal/companyOverview'
import { buildServiceCatalog } from '@/lib/portal/companyServices'
import { prisma } from '@/lib/prisma'
import { PORTAL } from '@/lib/brand/portalTokens'
import { ShareWithTeamsButton } from '@/components/portal/company/ShareWithTeamsButton'
import { NotificationSettings } from '@/components/portal/company/NotificationSettings'

export const dynamic = 'force-dynamic'

function fmtMoney(n: number | null): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

/** Calendar days render in UTC — see src/lib/dates/calendarDate.ts. */
function fmtDay(iso: string | Date | null): string {
  if (!iso) return '—'
  const d = typeof iso === 'string' ? new Date(`${iso.slice(0, 10)}T00:00:00Z`) : iso
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' })
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

function JobTile({ tile, companyId }: { tile: CompanyJobTile; companyId: string }) {
  return (
    <Link
      href={`/portal/company/${companyId}/job/${tile.id}`}
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
              {tile.leadContactName}
              {tile.leadContactRole && (
                <span className="text-zinc-400">· {tile.leadContactRole.replace(/_/g, ' ')}</span>
              )}
            </>
          ) : (
            <span className="text-zinc-400">No lead contact on file</span>
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

export default async function CompanyPortalPage({
  params,
}: {
  params: { companyId: string }
}) {
  const session = await getCompanyPortalSession(params.companyId, { touch: true })
  if (!session) notFound()

  const [overview, services, access] = await Promise.all([
    buildCompanyOverview(params.companyId),
    buildServiceCatalog(),
    prisma.companyPortalAccess.findUnique({
      where: { id: session.accessId },
      select: {
        notifyJobStart: true,
        notifyInvoicePaid: true,
        notifyJobClosed: true,
        notifyQuoteSent: true,
        cadence: true,
      },
    }),
  ])

  const { terms, active, past, totals } = overview

  return (
    <div className="min-h-screen bg-[#F8F7F4]">
      {/* ── Masthead ─────────────────────────────────────────────────
          Wes 2026-09-04: "put their word logo and ours at the top of
          page. Make them similar in size and put either an '&' sign or
          '|' between" — then "use | instead of &". Its own white band ABOVE the dark row rather than
          inside it: on a dark ground their mark would have to be
          recoloured to white, which works for a bare SVG and turns a PNG
          with a background into a white block. Here every format reads
          as itself. No logo yet → their name in the display face, so the
          page is still theirs. */}
      <div className="w-full bg-white border-b border-zinc-200">
        {/* Wes 2026-09-04: "right justify SirReel and Left justify
            Radical. Make Radical image 10% smaller." Their mark holds the
            left edge, ours the right, the rule keeps ours company. */}
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
                src={`/api/portal/company/${params.companyId}/logo`}
                alt={overview.companyName}
                className="block h-[29px] w-auto max-w-[220px] object-contain object-left"
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
            <img src="/sirreel-logo.png" alt="SirReel" className="block h-10 w-auto max-w-[220px] object-contain object-right" />
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
            <span className="font-semibold text-white">{session.personName}</span>
            <span className="text-white/40 hidden sm:inline">·</span>
            <span className="truncate max-w-full">{session.personEmail}</span>
            <span className="text-white/40 hidden sm:inline">·</span>
            <span style={{ color: PORTAL.gold }}>
              {session.title || COMPANY_PORTAL_ROLE_LABEL[session.role]}
            </span>
          </div>
          <form action="/api/portal/auth/signout" method="POST" className="shrink-0">
            <button
              type="submit"
              className="text-[11px] font-semibold border text-white/80 hover:text-white px-2.5 py-1 rounded-md transition-colors"
              style={{ borderColor: 'rgba(255,255,255,0.2)' }}
            >
              Sign out
            </button>
          </form>
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
            <h2 className="text-[11px] uppercase font-semibold tracking-[1.6px] text-zinc-500 mb-3">
              Your deals with SirReel
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {terms.negotiatedRates.map((r) => (
                <div key={r.id} className="bg-white border border-zinc-200 rounded-xl px-6 py-5">
                  <div className="text-[44px] leading-none font-medium tracking-tight text-zinc-900 tabular-nums">
                    <span className="text-[26px] font-normal text-zinc-500 mr-0.5">$</span>
                    {r.dailyRate.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    <span className="text-[26px] font-normal text-zinc-500 ml-0.5">/day</span>
                  </div>
                  <div className="mt-2 text-[17px] font-normal text-zinc-800 leading-snug">{r.label}</div>
                  {r.weeklyRate != null && (
                    <div className="text-xs text-zinc-500 mt-1.5">
                      ${r.weeklyRate.toLocaleString('en-US', { maximumFractionDigits: 0 })}/week
                    </div>
                  )}
                </div>
              ))}
              {terms.discounts.map((d) => (
                <div
                  key={d.id}
                  className="bg-white border border-zinc-200 rounded-xl px-6 py-5"
                >
                  <div className="text-[44px] leading-none font-medium tracking-tight text-zinc-900 tabular-nums">
                    {d.percentOff}
                    <span className="text-[26px] font-normal text-zinc-500 ml-0.5">% off</span>
                  </div>
                  <div className="mt-2 text-[17px] font-normal text-zinc-800 leading-snug">
                    {d.label}
                  </div>
                  {d.conditions && (
                    <div className="text-xs text-zinc-500 mt-1.5 leading-relaxed">{d.conditions}</div>
                  )}
                  {d.expiryDate && (
                    <div className="text-[11px] text-zinc-400 mt-1.5">Through {fmtDay(d.expiryDate)}</div>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-zinc-400 mt-2.5">
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
                      Every job your company books is papered by this agreement — your teams
                      aren&apos;t asked to sign a rental agreement per show.
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
                    href={`/api/portal/company/${params.companyId}/agreement/${terms.annual.companyAgreementId}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg text-white shrink-0"
                    style={{ backgroundColor: PORTAL.gold }}
                  >
                    <FileText className="w-4 h-4" /> Read the agreement
                  </a>
                </div>
              ) : (
                <div>
                  <div className="text-sm font-semibold text-zinc-900">Per-job rental agreement</div>
                  <p className="text-xs text-zinc-600 mt-1 leading-relaxed max-w-[62ch]">
                    Your account signs SirReel&apos;s rental agreement per show — each job&apos;s
                    coordinator signs it in their own job portal. If you&apos;d rather sign once for
                    the year, ask your rep about an annual agreement.
                  </p>
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
                      href={`/api/portal/company/${params.companyId}/agreement/${a.id}/pdf`}
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
                <JobTile key={t.id} tile={t} companyId={params.companyId} />
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
                <JobTile key={t.id} tile={t} companyId={params.companyId} />
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
              companyId={params.companyId}
              companyName={overview.companyName}
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {services.lines.map((line) => (
              <a
                key={line.key}
                href={line.href}
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

        {/* ── Notifications ────────────────────────────────────────────── */}
        <section>
          <h2 className="text-[11px] uppercase font-semibold tracking-[1.6px] text-zinc-500 mb-3">
            Keep me posted
          </h2>
          <NotificationSettings
            companyId={params.companyId}
            initial={{
              notifyJobStart: access?.notifyJobStart ?? true,
              notifyInvoicePaid: access?.notifyInvoicePaid ?? true,
              notifyJobClosed: access?.notifyJobClosed ?? true,
              notifyQuoteSent: access?.notifyQuoteSent ?? false,
              cadence: access?.cadence ?? 'IMMEDIATE',
            }}
          />
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
        · SirReel Production Vehicles
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
