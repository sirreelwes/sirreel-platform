import { HQ_BOOK_START, type Headline, type OwnerNumbers } from '@/lib/exec/ownerNumbers'
import { addMonths } from '@/lib/exec/periods'
import { ColumnChart, type Column } from '@/components/exec/ColumnChart'
import { compactMoney } from '@/lib/exec/format'

/**
 * The owner numbers page body — layout only. Every definition lives in
 * src/lib/exec/ownerNumbers.ts; the gate lives in the page.
 */

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

const SHORT_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const SHORT_MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })
const MONTH_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const dayLabel = (key: string) => SHORT_DAY.format(new Date(`${key}T00:00:00Z`))
const monthLabel = (key: string) => SHORT_MONTH.format(new Date(`${key}-01T00:00:00Z`))

function syncedLabel(iso: string | null): string {
  if (!iso) return 'RentalWorks mirror has not synced'
  const t = new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric',
  })
  return `RentalWorks figures as of ${t}`
}

export function OwnerNumbersView({ data }: { data: OwnerNumbers }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-5">
        <h1 className="text-[20px] font-semibold text-lt-fg">Sales &amp; collections</h1>
        <p className="text-[12px] text-lt-fg2">
          {data.monthLabel} so far, against the same days last month.{' '}
          <span className="text-lt-fg3">{syncedLabel(data.rwSyncedAt)}. Only you can see this page.</span>
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {data.headlines.map((h) => (
          <StatTile key={h.key} h={h} priorLabel={data.priorLabel} trackingSince={data.collections.trackingSince} />
        ))}
      </div>

      <SalesSection data={data} />
      <BillingSection data={data} />
      <CollectionsSection data={data} />
    </div>
  )
}

// ── Headline tiles ─────────────────────────────────────────────────────────

function StatTile({ h, priorLabel, trackingSince }: { h: Headline; priorLabel: string; trackingSince: string | null }) {
  const isCount = h.key === 'orders'
  const fmt = (n: number) => (isCount ? n.toLocaleString('en-US') : usd(n))
  return (
    <div className="rounded-lg border border-lt-hairline bg-lt-card p-4" title={h.note}>
      <div className="text-[12px] text-lt-fg2">{h.label}</div>
      <div className="mt-1 text-[26px] font-semibold leading-tight tabular-nums text-lt-fg">{fmt(h.value)}</div>
      <div className="mt-0.5 text-[12px] text-lt-fg3">
        {isCount ? 'this month' : `${h.count} ${h.key === 'won' ? 'order' : 'invoice'}${h.count === 1 ? '' : 's'}`}
      </div>
      <div className="mt-2 space-y-0.5 text-[12px]">
        {h.prior === null ? (
          <div className="text-lt-fg3">
            {h.key === 'collected'
              ? `No comparison yet — tracking began ${trackingSince ? dayLabel(trackingSince) : 'recently'}`
              : h.key === 'invoiced'
                ? `No ${priorLabel} history`
                : `Compared from ${SHORT_MONTH.format(new Date(`${addMonths(HQ_BOOK_START.slice(0, 7), 1)}-01T00:00:00Z`))} — HQ held the whole book from ${dayLabel(HQ_BOOK_START)}`}
          </div>
        ) : (
          <Delta value={h.value} base={h.prior} label={`vs ${priorLabel}`} fmt={fmt} />
        )}
        {h.lastYear !== null && <Delta value={h.value} base={h.lastYear} label="vs last year" fmt={fmt} />}
      </div>
    </div>
  )
}

function Delta({ value, base, label, fmt }: { value: number; base: number; label: string; fmt: (n: number) => string }) {
  const diff = value - base
  const pct = base > 0 ? Math.round((diff / base) * 100) : null
  const tone = diff > 0 ? 'text-chip-good-fg' : diff < 0 ? 'text-chip-bad-fg' : 'text-lt-fg2'
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5">
      <span className={`font-medium tabular-nums ${tone}`}>
        {diff >= 0 ? '▲' : '▼'} {pct === null ? fmt(Math.abs(diff)) : `${Math.abs(pct)}%`}
      </span>
      <span className="text-lt-fg3">
        {label} ({fmt(base)})
      </span>
    </div>
  )
}

// ── Sections ───────────────────────────────────────────────────────────────

function Section({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-[16px] font-semibold text-lt-fg">{title}</h2>
      <p className="mb-3 text-[12px] text-lt-fg2">{sub}</p>
      {children}
    </section>
  )
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-lt-hairline bg-lt-card p-4">
      <div className="text-[13px] font-medium text-lt-fg">{title}</div>
      {sub && <div className="text-[11px] text-lt-fg3">{sub}</div>}
      <div className="mt-3">{children}</div>
    </div>
  )
}

function SalesSection({ data }: { data: OwnerNumbers }) {
  const { weeks, byRep, pipeline } = data.sales
  const partialNote = `Before ${dayLabel(HQ_BOOK_START)} — HQ did not hold every order yet`
  const orderCols: Column[] = weeks.map((w) => ({
    key: w.week,
    label: dayLabel(w.week),
    value: w.newOrders,
    muted: w.partialBook,
    detail: [
      `Week of ${dayLabel(w.week)}`,
      `${w.quoted} quote${w.quoted === 1 ? '' : 's'} sent · ${usd(w.quotedValue)}`,
      ...(w.partialBook ? [partialNote] : []),
    ],
  }))
  const wonCols: Column[] = weeks.map((w) => ({
    key: w.week,
    label: dayLabel(w.week),
    value: w.wonValue,
    muted: w.partialBook,
    detail: [
      `Week of ${dayLabel(w.week)} · ${w.won} order${w.won === 1 ? '' : 's'}`,
      ...(w.partialBook ? [partialNote] : []),
    ],
  }))

  return (
    <Section title="Sales" sub="HQ orders. Weeks start Monday; lighter weeks are from before HQ held the whole book.">
      <div className="grid gap-3 md:grid-cols-2">
        <Card title="New orders per week">
          <ColumnChart columns={orderCols} format="count" />
        </Card>
        <Card title="Booked per week" sub="At the booked value, when the client said yes">
          <ColumnChart columns={wonCols} format="money" />
        </Card>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-lt-hairline bg-lt-card p-4">
          <div className="text-[12px] text-lt-fg2">Quotes out, waiting on the client</div>
          <div className="mt-1 text-[22px] font-semibold tabular-nums text-lt-fg">{usd(pipeline.openQuotes.value)}</div>
          <div className="text-[12px] text-lt-fg3">{pipeline.openQuotes.count} open quotes</div>
        </div>
        <div className="rounded-lg border border-lt-hairline bg-lt-card p-4">
          <div className="text-[12px] text-lt-fg2">Approved, not yet booked</div>
          <div className="mt-1 text-[22px] font-semibold tabular-nums text-lt-fg">{usd(pipeline.wonNotBooked.value)}</div>
          <div className="text-[12px] text-lt-fg3">{pipeline.wonNotBooked.count} orders</div>
        </div>
        <div className="rounded-lg border border-lt-hairline bg-lt-card p-4 md:row-span-1">
          <div className="text-[12px] text-lt-fg2">{data.monthLabel} by rep</div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-lt-fg3">
                  <th className="pb-1 font-normal">Rep</th>
                  <th className="pb-1 text-right font-normal">Orders</th>
                  <th className="pb-1 text-right font-normal">Quoted</th>
                  <th className="pb-1 text-right font-normal">Booked</th>
                </tr>
              </thead>
              <tbody>
                {byRep.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-2 text-lt-fg3">No orders yet this month.</td>
                  </tr>
                )}
                {byRep.map((r) => (
                  <tr key={r.name} className="border-t border-lt-hairline text-lt-fg">
                    <td className="py-1.5">{r.name.split(' ')[0]}</td>
                    <td className="py-1.5 text-right tabular-nums">{r.newOrders}</td>
                    <td className="py-1.5 text-right tabular-nums">{compactMoney(r.quotedValue)}</td>
                    <td className="py-1.5 text-right tabular-nums">{compactMoney(r.wonValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Section>
  )
}

function BillingSection({ data }: { data: OwnerNumbers }) {
  const { months } = data.billing
  const current = data.today.slice(0, 7)
  const cols: Column[] = months.map((m) => ({
    key: m.month,
    label: monthLabel(m.month),
    value: m.invoiced,
    muted: m.month === current,
    detail: [
      MONTH_YEAR.format(new Date(`${m.month}-01T00:00:00Z`)) + (m.month === current ? ' · so far' : ''),
      `${m.invoiceCount} invoices`,
    ],
  }))

  return (
    <Section
      title="Invoiced"
      sub="RentalWorks invoices by invoice date, voids excluded and credits netted, plus HQ invoices sent."
    >
      <div className="grid gap-3 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Card title="Invoiced per month" sub="This month is still in progress">
            <ColumnChart columns={cols} format="money" height={180} />
          </Card>
        </div>
        <div className="lg:col-span-2">
          <Card title="Collected against each month's invoices">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-lt-fg3">
                    <th className="pb-1 font-normal">Month</th>
                    <th className="pb-1 text-right font-normal">Invoiced</th>
                    <th className="pb-1 text-right font-normal">Still owed</th>
                    <th className="pb-1 text-right font-normal">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {[...months].reverse().map((m) => {
                    const owed = Math.max(0, m.invoiced - m.collected)
                    const pct = m.invoiced > 0 ? Math.min(100, Math.round((m.collected / m.invoiced) * 100)) : null
                    return (
                      <tr key={m.month} className="border-t border-lt-hairline text-lt-fg">
                        <td className="py-1.5">{MONTH_YEAR.format(new Date(`${m.month}-01T00:00:00Z`))}</td>
                        <td className="py-1.5 text-right tabular-nums">{usd(m.invoiced)}</td>
                        <td className="py-1.5 text-right tabular-nums">{owed > 0 ? usd(owed) : '—'}</td>
                        <td className="py-1.5 text-right tabular-nums text-lt-fg2">{pct === null ? '—' : `${pct}%`}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-lt-fg3">
              &ldquo;Still owed&rdquo; is what RentalWorks shows unreceived — it includes anything since written off.
            </p>
          </Card>
        </div>
      </div>
    </Section>
  )
}

function CollectionsSection({ data }: { data: OwnerNumbers }) {
  const c = data.collections
  const cols: Column[] = c.weeks.map((w) => ({
    key: w.week,
    label: dayLabel(w.week),
    value: w.total,
    detail:
      w.total === null
        ? ['Before tracking began']
        : [`Week of ${dayLabel(w.week)}`, `RentalWorks paid off ${usd(w.rw)}`, `HQ invoices ${usd(w.hq)}`],
  }))
  const maxAging = Math.max(1, ...c.aging.map((b) => b.amount))

  return (
    <Section
      title="Collections"
      sub="Money in, and what is still owed. RentalWorks counts an invoice when it is paid off, so a part-payment shows up when it finishes."
    >
      <div className="grid gap-3 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Card
            title="Collected per week"
            sub={c.trackingSince ? `Tracked since ${dayLabel(c.trackingSince)}; earlier weeks show no data` : undefined}
          >
            <ColumnChart columns={cols} format="money" height={180} />
          </Card>
        </div>
        <div className="lg:col-span-2">
          <Card title="Open receivables" sub="Age since invoicing — SirReel invoices are due on receipt">
            <div className="text-[26px] font-semibold tabular-nums text-lt-fg">{usd(c.openTotal)}</div>
            <div className="text-[12px] text-lt-fg3">{c.openCount} invoices</div>
            <div className="mt-3 space-y-2">
              {c.aging.map((b) => (
                <div key={b.key}>
                  <div className="flex justify-between text-[12px]">
                    <span className="text-lt-fg2">{b.label}</span>
                    <span className="tabular-nums text-lt-fg">
                      {usd(b.amount)} <span className="text-lt-fg3">· {b.count}</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-lt-inner">
                    <div
                      className="h-1.5 rounded-full"
                      style={{ width: `${(b.amount / maxAging) * 100}%`, background: '#0F7A93' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-3">
        <Card title="Largest balances">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[12px] text-lt-fg3">
                  <th className="pb-1 font-normal">Client</th>
                  <th className="pb-1 text-right font-normal">Owed</th>
                  <th className="pb-1 text-right font-normal">Invoices</th>
                  <th className="pb-1 text-right font-normal">Oldest</th>
                </tr>
              </thead>
              <tbody>
                {c.topOwing.map((o) => (
                  <tr key={o.name} className="border-t border-lt-hairline text-lt-fg">
                    <td className="py-1.5">{o.name}</td>
                    <td className="py-1.5 text-right tabular-nums">{usd(o.amount)}</td>
                    <td className="py-1.5 text-right tabular-nums">{o.count}</td>
                    <td className={`py-1.5 text-right tabular-nums ${o.oldestDays > 60 ? 'text-chip-bad-fg' : 'text-lt-fg2'}`}>
                      {o.oldestDays}d
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </Section>
  )
}
