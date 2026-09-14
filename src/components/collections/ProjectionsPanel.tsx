'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

/**
 * The weekly collections forecast.
 *
 * Ana, 2026-09-14: *"Do we have a tool to create weekly collections
 * projections? I can go off RentalWorks for anything made there, but we'll
 * need something going forward."*
 *
 * Two lines per week, and the distinction between them is the whole design:
 *
 *   TO BILL   what is due to be INVOICED that week. HQ knows this cold — an
 *             order comes back, Ana bills it the next day.
 *   EXPECTED  what should ARRIVE that week. Rests on an assumption about how
 *             fast clients pay, because HQ cannot measure that yet (three
 *             paid HQ invoices in history). The assumption is a control at
 *             the top of the page rather than a hidden constant, so the
 *             person reading the forecast owns it.
 *
 * Quoted work is shown in its own muted column and is never added to a total.
 * Most of this yard's forward book sits in QUOTE_SENT, so leaving it out
 * entirely made the month look dead — but counting it as cash would forecast
 * money nobody has agreed to pay.
 */

interface ProjectionItem {
  source: 'INVOICED' | 'TO_BILL' | 'UPCOMING' | 'QUOTED'
  label: string
  sublabel: string | null
  amount: number
  expectedYmd: string
  billYmd: string | null
  pipe: 'HQ' | 'RW'
  href: string | null
}

interface ProjectionWeek {
  startYmd: string
  endYmd: string
  label: string
  invoiced: number
  toBill: number
  upcoming: number
  quoted: number
  total: number
  billing: number
  items: ProjectionItem[]
}

interface Projection {
  generatedAt: string
  todayYmd: string
  lag: {
    assumedDays: number
    measured: {
      hqMedianDays: number | null
      hqSamples: number
      rwMedianDays: number | null
      rwSamples: number
      usable: boolean
      why: string
    }
  }
  weeks: ProjectionWeek[]
  overdue: { amount: number; count: number; items: ProjectionItem[] }
  actuals: { startYmd: string; label: string; amount: number }[]
  rwSyncedAt: string | null
  totals: { invoiced: number; toBill: number; upcoming: number; quoted: number; all: number }
}

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
const usdExact = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const SOURCE_LABEL: Record<ProjectionItem['source'], string> = {
  INVOICED: 'invoiced',
  TO_BILL: 'to bill',
  UPCOMING: 'on the books',
  QUOTED: 'quoted',
}

const LAG_CHOICES = [0, 7, 14, 30, 45]

export function ProjectionsPanel() {
  const [data, setData] = useState<Projection | null>(null)
  const [lag, setLag] = useState(14)
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (days: number) => {
    try {
      const r = await fetch(`/api/collections/projections?lag=${days}`, { cache: 'no-store' })
      if (!r.ok) {
        setError(r.status === 403 ? 'You do not have access to collections.' : 'That did not load.')
        return
      }
      setData((await r.json()) as Projection)
      setError(null)
    } catch {
      setError('That did not load.')
    }
  }, [])

  useEffect(() => {
    void load(lag)
  }, [load, lag])

  if (error && !data) {
    return <div className="rounded-lg border border-lt-hairline bg-lt-card p-6 text-[13px] text-lt-fg2">{error}</div>
  }
  if (!data) {
    return <div className="rounded-lg border border-lt-hairline bg-lt-card p-6 text-[13px] text-lt-fg3">Working it out…</div>
  }

  const peak = Math.max(
    1,
    ...data.weeks.map((w) => Math.max(w.total, w.billing, w.quoted)),
    ...data.actuals.map((a) => a.amount),
  )
  const avgActual =
    data.actuals.filter((a) => a.amount > 0).length > 0
      ? data.actuals.reduce((n, a) => n + a.amount, 0) /
        data.actuals.filter((a) => a.amount > 0).length
      : 0

  return (
    <div className="space-y-4">
      {/* ── The assumption, stated up front ───────────────────────── */}
      <div className="rounded-lg border border-lt-hairline bg-lt-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[13px] text-lt-fg2">
            Assuming clients pay{' '}
            <strong className="text-lt-fg">{data.lag.assumedDays} days</strong> after the invoice
            goes out.
          </div>
          <div className="flex items-center gap-1">
            {LAG_CHOICES.map((d) => (
              <button
                key={d}
                onClick={() => setLag(d)}
                className={`rounded px-2 py-1 text-[11px] ${
                  lag === d
                    ? 'bg-lt-fg text-white'
                    : 'border border-lt-hairline text-lt-fg2 hover:bg-lt-inner'
                }`}
              >
                {d === 0 ? 'same day' : `${d}d`}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-lt-fg3">
          {data.lag.measured.usable
            ? `HQ's own history says ${data.lag.measured.hqMedianDays} days across ${data.lag.measured.hqSamples} paid invoices.`
            : `This is an assumption, not a measurement: ${data.lag.measured.why}. The billing line below does not depend on it.`}
        </p>
      </div>

      {/* ── Weeks ─────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-lt-hairline bg-lt-card">
        <div className="border-b border-lt-hairline px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12px] font-semibold text-lt-fg">Next six weeks</span>
          <span className="text-[11px] text-lt-fg3">
            {usdExact(data.totals.all)} expected · {usdExact(data.totals.quoted)} more in quotes
          </span>
        </div>
        <ul className="divide-y divide-lt-hairline">
          {data.weeks.map((w) => {
            const isOpen = open === w.startYmd
            return (
              <li key={w.startYmd}>
                <button
                  onClick={() => setOpen(isOpen ? null : w.startYmd)}
                  className="w-full px-4 py-3 text-left hover:bg-lt-inner/50"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] font-medium text-lt-fg">{w.label}</span>
                    <span className="text-[15px] font-semibold tabular-nums text-lt-fg">
                      {w.total > 0 ? usd(w.total) : <span className="text-lt-fg3">—</span>}
                    </span>
                  </div>
                  {/* Expected (solid) over quoted (hatched-muted). Same scale,
                      so a week that is mostly quotes looks like one. */}
                  <div className="mt-1.5 h-2 w-full rounded-full bg-lt-inner overflow-hidden flex">
                    <div
                      className="h-full bg-emerald-500"
                      style={{ width: `${(w.total / peak) * 100}%` }}
                    />
                    <div
                      className="h-full bg-emerald-500/25"
                      style={{ width: `${(w.quoted / peak) * 100}%` }}
                    />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-lt-fg3">
                    <span>
                      To bill this week:{' '}
                      <strong className="text-lt-fg2 tabular-nums">{usd(w.billing)}</strong>
                    </span>
                    {w.invoiced > 0 && <span>invoiced {usd(w.invoiced)}</span>}
                    {w.toBill > 0 && <span>to bill {usd(w.toBill)}</span>}
                    {w.upcoming > 0 && <span>on the books {usd(w.upcoming)}</span>}
                    {w.quoted > 0 && <span className="italic">quoted {usd(w.quoted)} — not counted</span>}
                  </div>
                </button>
                {isOpen && (
                  <ul className="border-t border-lt-hairline bg-lt-inner/40 px-4 py-2 space-y-1">
                    {w.items.length === 0 ? (
                      <li className="text-[12px] text-lt-fg3 py-1">Nothing expected this week.</li>
                    ) : (
                      w.items.map((it, i) => (
                        <li key={`${it.label}-${i}`} className="flex items-center gap-2 text-[12px]">
                          <span className="w-20 shrink-0 text-lt-fg3">{SOURCE_LABEL[it.source]}</span>
                          <span className="min-w-0 flex-1 truncate text-lt-fg">
                            {it.href ? (
                              <Link href={it.href} className="hover:underline">
                                {it.label}
                              </Link>
                            ) : (
                              it.label
                            )}
                            {it.sublabel ? <span className="text-lt-fg3"> · {it.sublabel}</span> : null}
                          </span>
                          <span className="shrink-0 tabular-nums text-lt-fg2">{usdExact(it.amount)}</span>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      {/* ── Overdue, never smeared into a future week ──────────────── */}
      {data.overdue.count > 0 && (
        <div className="rounded-lg border border-lt-hairline bg-lt-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[12px] font-semibold text-lt-fg">
              Already expected and not here
            </span>
            <span className="text-[15px] font-semibold tabular-nums text-chip-bad-fg">
              {usdExact(data.overdue.amount)}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-lt-fg3">
            {data.overdue.count} invoice{data.overdue.count === 1 ? '' : 's'} whose expected date has
            passed. Deliberately not pushed into next week — nothing about the calendar makes them
            more likely to arrive on Tuesday.
          </p>
          <ul className="mt-2 space-y-1">
            {data.overdue.items.slice(0, 8).map((it, i) => (
              <li key={`${it.label}-${i}`} className="flex items-center gap-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-lt-fg">
                  {it.label}
                  {it.sublabel ? <span className="text-lt-fg3"> · {it.sublabel}</span> : null}
                </span>
                <span className="shrink-0 tabular-nums text-lt-fg2">{usdExact(it.amount)}</span>
              </li>
            ))}
          </ul>
          {data.overdue.count > 8 && (
            <Link href="/collections/aging-review" className="mt-2 inline-block text-[11px] font-semibold text-lt-fg2 hover:text-lt-fg">
              All of it in aging review →
            </Link>
          )}
        </div>
      )}

      {/* ── What actually landed, to read the forecast against ─────── */}
      <div className="rounded-lg border border-lt-hairline bg-lt-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[12px] font-semibold text-lt-fg">What actually landed</span>
          <span className="text-[11px] text-lt-fg3">
            {avgActual > 0 ? `${usd(avgActual)}/week average over the weeks that had money in` : 'no history yet'}
          </span>
        </div>
        <div className="mt-3 flex items-end gap-1.5 h-16">
          {data.actuals.map((a) => (
            <div key={a.startYmd} className="flex-1 flex flex-col items-center gap-1" title={`${a.label}: ${usdExact(a.amount)}`}>
              <div
                className="w-full rounded-sm bg-lt-fg3/40"
                style={{ height: `${Math.max(2, (a.amount / peak) * 56)}px` }}
              />
              <span className="text-[9px] text-lt-fg3">{a.label}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-lt-fg3">
          Card charges, bank money marked collected, and HQ invoice payments — the same figures the
          desk view counts. HQ-native collections only started in August, so the early weeks are
          empty because nothing ran through here, not because nothing was collected.
        </p>
      </div>

      <p className="text-[11px] text-lt-fg3">
        Reads the live RentalWorks mirror
        {data.rwSyncedAt
          ? `, last synced ${new Date(data.rwSyncedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
          : ''}
        . Anything invoiced in RentalWorks since that sync is not here yet. Deposits and holds are
        not included.
      </p>
    </div>
  )
}
