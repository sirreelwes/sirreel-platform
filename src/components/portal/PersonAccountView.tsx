/**
 * The person's portal home — the same body behind two doors:
 *   /portal/account                       (the signed-in person)
 *   /crm/portals/preview/person/[id]      (HQ, "see what they see")
 *
 * Server component. Every show the person has touched, current first,
 * then the history across every company they have worked for — each with
 * its orders, its paperwork state, and a way back into the show's own
 * portal when they still hold a live link to it.
 */

import Link from 'next/link'
import type { JobRole, OrderStatus } from '@prisma/client'
import { ArrowUpRight, Building2, CheckCircle2, FileText } from 'lucide-react'
import { PORTAL, PORTAL_SERIF } from '@/lib/brand/portalTokens'
import { RequestAddOnButton } from '@/components/portal/RequestAddOnButton'
import type { PersonAccount, PersonJobTile, PersonAccountOrder } from '@/lib/portal/personAccount'

const ROLE_LABEL: Record<JobRole, string> = {
  PRODUCER: 'Producer',
  PM: 'Production manager',
  PC: 'Production coordinator',
  TRANSPO: 'Transportation',
  ACCOUNTING: 'Accounting',
  OTHER: 'Contact',
}

const ORDER_STATUS_LABEL: Partial<Record<OrderStatus, string>> = {
  DRAFT: 'Draft',
  QUOTE_SENT: 'Quote sent',
  APPROVED: 'Approved',
  BOOKED: 'Booked',
  LOADED_READY: 'Ready',
  ON_JOB: 'On the job',
  RETURNED: 'Returned',
  LD_CHECK: 'Checking in',
  INVOICED: 'Invoiced',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
}

const STATE_CHIP: Record<PersonJobTile['state'], string> = {
  QUOTED: 'bg-purple-50 text-purple-700 border-purple-200',
  UPCOMING: 'bg-sky-50 text-sky-700 border-sky-200',
  ON_JOB: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  HOLD: 'bg-amber-50 text-amber-800 border-amber-200',
  WRAPPED: 'bg-zinc-100 text-zinc-600 border-zinc-200',
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || n === 0) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

/** ISO calendar day → "Aug 18, 26". UTC on purpose: these are @db.Date columns. */
function fmtDay(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' })
}

function fmtRange(start: string | null, end: string | null): string {
  if (!start && !end) return 'Dates to be set'
  if (start && end && start === end) return fmtDay(start)
  return `${fmtDay(start)} → ${fmtDay(end)}`
}

export function PersonAccountView({
  account,
  preview = false,
}: {
  account: PersonAccount
  /** HQ preview: inert actions, show links go to the staff twin. */
  preview?: boolean
}) {
  const { person, current, history, companies, supplyRequests, totals } = account
  const fullName = `${person.firstName} ${person.lastName}`.trim()

  // Every show on a company opens into its own page — invoices, paperwork,
  // who was on it — gated on the person being attached (personJobAccess.ts).
  // The order rows below keep the magic link into the live show portal.
  const showHref = (t: PersonJobTile): string | null => {
    if (!t.companyId) return null
    return preview ? `/crm/portals/preview/person/${person.id}/job/${t.id}` : `/portal/account/job/${t.id}`
  }

  return (
    <div className="min-h-screen bg-[#F8F7F4]">
      <link
        href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap"
        rel="stylesheet"
      />

      {/* Dark hero — the same touchpoint family as the per-show portal and
          the welcome email. */}
      <header className="w-full" style={{ backgroundColor: PORTAL.dark }}>
        <div className="max-w-4xl mx-auto px-6 py-7 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 text-center sm:text-left">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/sirreel-logo-white.png"
              alt="SirReel Studio Services"
              width={160}
              style={{ display: 'inline-block', maxWidth: 160, height: 'auto' }}
            />
            <div className="mt-3 sm:mx-0 mx-auto" style={{ width: 48, height: 2, backgroundColor: PORTAL.gold }} />
            <div className="mt-3 text-[10px] uppercase font-semibold" style={{ color: PORTAL.gold, letterSpacing: '2.5px' }}>
              Your portal
            </div>
            <h1 className="mt-1 text-white text-[24px] font-light italic leading-tight" style={{ fontFamily: PORTAL_SERIF }}>
              Hi {person.firstName}.
            </h1>
            <div className="text-xs text-white/60 mt-1 truncate">{person.email}</div>
          </div>
          {preview ? (
            <span className="shrink-0 text-[11px] font-semibold border text-white/50 px-3 py-1.5 rounded-lg" style={{ borderColor: 'rgba(255,255,255,0.2)' }}>
              Sign out
            </span>
          ) : (
            <form action="/api/portal/auth/signout" method="POST" className="shrink-0">
              <button
                type="submit"
                className="text-[11px] font-semibold border text-white/80 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
                style={{ borderColor: 'rgba(255,255,255,0.2)' }}
              >
                Sign out
              </button>
            </form>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* The numbers that say who this person is to SirReel. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Shows" value={String(totals.shows)} />
          <Stat label="Companies" value={String(totals.companies)} />
          <Stat label="Invoiced to date" value={totals.invoiced > 0 ? fmtMoney(totals.invoiced) : '$0'} />
          <Stat label="Open balance" value={totals.balanceDue > 0 ? fmtMoney(totals.balanceDue) : '$0'} />
        </div>

        <Section title="Your shows" count={current.length}>
          {current.length === 0 ? (
            <Empty>Nothing running right now. New shows appear here as soon as a quote goes out.</Empty>
          ) : (
            <div className="space-y-3">
              {current.map((t) => (
                <ShowCard key={t.id} tile={t} href={showHref(t)} preview={preview} />
              ))}
            </div>
          )}
        </Section>

        <Section title="History" count={history.length}>
          {history.length === 0 ? (
            <Empty>Wrapped shows stay here — every job you have run with us, whichever company it was for.</Empty>
          ) : (
            <div className="space-y-3">
              {history.map((t) => (
                <ShowCard key={t.id} tile={t} href={showHref(t)} preview={preview} />
              ))}
            </div>
          )}
        </Section>

        {companies.length > 0 && (
          <Section title="Companies you've worked with" count={companies.length}>
            <div className="flex flex-wrap gap-2">
              {companies.map((c) => (
                <span
                  key={c.id ?? c.name}
                  className="inline-flex items-center gap-2 bg-white border border-zinc-200 rounded-full pl-2.5 pr-3 py-1.5 text-sm text-zinc-800"
                >
                  <Building2 className="w-3.5 h-3.5 text-zinc-400" />
                  <span className="font-medium">{c.name}</span>
                  <span className="text-xs text-zinc-500">
                    {c.shows} show{c.shows === 1 ? '' : 's'}
                    {c.lastDate ? ` · last ${fmtDay(c.lastDate)}` : ''}
                  </span>
                </span>
              ))}
            </div>
          </Section>
        )}

        <Section title="Supply requests" count={supplyRequests.length}>
          {supplyRequests.length === 0 ? (
            <Empty>
              No supply requests yet.{' '}
              {preview ? (
                <span className="underline">Build an order →</span>
              ) : (
                <a href="/order/supplies" className="text-amber-700 hover:text-amber-600 underline">
                  Build an order →
                </a>
              )}
            </Empty>
          ) : (
            <div className="space-y-3">
              {supplyRequests.map((r) => (
                <Card key={r.id}>
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-zinc-500">{r.reference}</span>
                        <Chip tone="neutral">{r.status.toLowerCase()}</Chip>
                        {r.convertedJobCode && <Chip tone="good">{r.convertedJobCode}</Chip>}
                      </div>
                      <div className="text-sm font-semibold text-zinc-900 mt-0.5 truncate">{r.title}</div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        {r.units} unit{r.units === 1 ? '' : 's'} · est. {fmtMoney(r.estimatedValue)}
                      </div>
                    </div>
                    <div className="text-right text-xs text-zinc-500 flex-shrink-0">
                      {fmtRange(r.preferredStartDate, r.preferredEndDate)}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Section>

        <div className="text-center text-xs text-zinc-400 pt-4 pb-8">
          Signed in as {fullName || person.email}. Anything missing? Ping your SirReel agent.
        </div>
      </main>

      <footer className="border-t border-gray-200" style={{ backgroundColor: '#fafaf8' }}>
        <div className="max-w-4xl mx-auto px-6 py-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/s-logo-black.png"
            alt="SirReel"
            width={30}
            style={{ display: 'inline-block', width: 30, height: 'auto', opacity: 0.55 }}
          />
          <p className="mt-2 text-[10px] tracking-wide leading-relaxed" style={{ color: '#888' }}>
            SirReel Studio Services
            <br />
            8500 Lankershim Blvd, Sun Valley, CA 91352
          </p>
          <p className="mt-2 text-[11px]" style={{ color: PORTAL.gold }}>
            After-hours:{' '}
            <a href="tel:+18884777335" style={{ color: PORTAL.gold }}>
              (888) 477-7335
            </a>
          </p>
        </div>
      </footer>
    </div>
  )
}

/* ───────────────────────── pieces ───────────────────────── */

function ShowCard({ tile, href, preview }: { tile: PersonJobTile; href: string | null; preview: boolean }) {
  const wrapped = tile.state === 'WRAPPED'
  return (
    <Card>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className="font-mono text-zinc-500">{tile.jobCode}</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${STATE_CHIP[tile.state]}`}>
              {tile.stateLabel}
            </span>
            {tile.role && <Chip tone="neutral">You · {ROLE_LABEL[tile.role]}</Chip>}
          </div>
          <div className="text-[15px] font-semibold text-zinc-900 mt-1 truncate">{tile.name}</div>
          <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-zinc-400" />
            {tile.companyName}
            <span className="text-zinc-300">·</span>
            {fmtRange(tile.startDate, tile.endDate)}
          </div>
        </div>
        <div className="text-right text-xs text-zinc-500 flex-shrink-0 space-y-1">
          {tile.invoicedTotal != null ? (
            <>
              <div className="font-mono text-zinc-900 text-sm">{fmtMoney(tile.invoicedTotal)} invoiced</div>
              {tile.balanceDue > 0 ? (
                <div className="text-amber-800">{fmtMoney(tile.balanceDue)} open</div>
              ) : (
                <div className="inline-flex items-center gap-1 text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Paid
                </div>
              )}
            </>
          ) : (
            <div>{wrapped ? 'Not invoiced' : 'Not yet invoiced'}</div>
          )}
          {tile.agreementSigned && (
            <div className="inline-flex items-center gap-1 text-zinc-600">
              <FileText className="w-3.5 h-3.5" /> Agreement signed
            </div>
          )}
        </div>
      </div>

      {tile.orders.length > 0 && (
        <ul className="mt-3 border-t border-zinc-100 pt-2 divide-y divide-zinc-100">
          {tile.orders.map((o) => (
            <OrderRow key={o.id} order={o} preview={preview} />
          ))}
        </ul>
      )}

      <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
        {href ? (
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-sm font-semibold hover:underline"
            style={{ color: PORTAL.gold }}
          >
            Open this show <ArrowUpRight className="w-4 h-4" />
          </Link>
        ) : (
          <span className="text-xs text-zinc-400">Ask your rep for the paperwork on this show.</span>
        )}
        {!wrapped && !preview && <RequestAddOnButton jobId={tile.id} jobName={tile.name} />}
      </div>
    </Card>
  )
}

function OrderRow({ order, preview }: { order: PersonAccountOrder; preview: boolean }) {
  const label = ORDER_STATUS_LABEL[order.status] ?? order.status
  const body = (
    <>
      <span className="font-mono text-zinc-500">{order.orderNumber}</span>
      <Chip tone={order.status === 'CANCELLED' ? 'bad' : 'neutral'}>{label}</Chip>
      <span className="text-zinc-500">{fmtRange(order.startDate, order.endDate)}</span>
      <span className="ml-auto font-mono text-zinc-800">{fmtMoney(order.total)}</span>
    </>
  )
  const cls = 'flex items-center gap-2 py-1.5 text-xs flex-wrap'
  if (order.portalHref && !preview) {
    return (
      <li>
        <Link href={order.portalHref} className={`${cls} hover:bg-zinc-50 -mx-1 px-1 rounded`}>
          {body}
        </Link>
      </li>
    )
  }
  return <li className={cls}>{body}</li>
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-xl px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500 font-semibold">{label}</div>
      <div className="text-lg font-medium text-zinc-900 mt-0.5 font-mono">{value}</div>
    </div>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 mb-3 flex items-baseline justify-between">
        <span>{title}</span>
        <span className="text-zinc-400 font-mono normal-case">{count}</span>
      </h2>
      {children}
    </section>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-white border border-zinc-200 rounded-xl p-4 shadow-sm">{children}</div>
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white border border-dashed border-zinc-200 rounded-xl p-6 text-sm text-zinc-500 text-center">
      {children}
    </div>
  )
}

function Chip({ tone, children }: { tone: 'neutral' | 'good' | 'bad'; children: React.ReactNode }) {
  const cls =
    tone === 'good'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : tone === 'bad'
        ? 'bg-rose-50 text-rose-700 border-rose-200'
        : 'bg-zinc-100 text-zinc-600 border-zinc-200'
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${cls}`}>
      {children}
    </span>
  )
}
