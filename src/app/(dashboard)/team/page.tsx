'use client'

/**
 * /team — how the watched employees are tracking, each against themselves.
 *
 * Wes, 2026-09-09: "an efficiency page showing how much different watched
 * employees perform. For now Ana, Jose and Oliver but eventually more."
 *
 * ── Why there is no leaderboard ───────────────────────────────────────────
 * Ana's outcome is a cleared invoice, a rep's is a booked order; her inbound
 * mail passes a positive-only ingest filter and theirs passes a negative
 * junk filter. There is no shared denominator, so a shared ranking would
 * measure role rather than effort. Every number here is paired with the SAME
 * person's previous window of equal length — the comparison that is actually
 * valid, and the one that surfaces a real drop-off.
 *
 * ── Why the caveats are on the page and not in a doc ──────────────────────
 * These numbers are a floor, not a total: no phone calls, nothing done
 * inside RentalWorks, and nothing worked out of the shared info@/hello@
 * inboxes. A number read without that is a wrong conclusion about a named
 * person, so the limits travel with the figure rather than living somewhere
 * they can be skipped.
 *
 * Allowlisted to Wes (src/lib/team/allowlist.ts). The nav row is hidden for
 * everyone else and the page does not trust the nav — the API re-checks and
 * a 403 renders Restricted.
 */

import { useCallback, useEffect, useState } from 'react'

type Unit = 'count' | 'usd' | 'pct' | 'hours'

interface Stat {
  key: string
  label: string
  value: number | null
  prior: number | null
  unit: Unit
  betterHigher: boolean | null
  hint?: string
}

interface PersonReport {
  email: string
  name: string
  kind: 'SALES' | 'COLLECTIONS'
  caveat?: string
  hasUser: boolean
  outcomes: Stat[]
  effort: Stat[]
  responsiveness: Stat[]
}

type Tab = 'outcomes' | 'effort' | 'responsiveness'

const TABS: [Tab, string, string][] = [
  ['outcomes', 'Outcomes', 'What landed — booked work and cleared money.'],
  ['effort', 'Effort', 'Visible activity. A floor, not a total.'],
  ['responsiveness', 'Responsiveness', 'How fast inbound gets an answer.'],
]

const WINDOWS: [number, string][] = [
  [7, '7 days'],
  [30, '30 days'],
  [90, '90 days'],
]

function fmt(v: number | null, unit: Unit): string {
  if (v === null) return '—'
  if (unit === 'usd') return `$${Math.round(v).toLocaleString('en-US')}`
  if (unit === 'pct') return `${Math.round(v)}%`
  if (unit === 'hours') return v < 1 ? `${Math.round(v * 60)}m` : `${v.toFixed(1)}h`
  return v.toLocaleString('en-US')
}

/** The delta line under a figure. Grey whenever "better" isn't obvious —
 *  more leads assigned or more mail sent is not self-evidently good. */
function Delta({ s }: { s: Stat }) {
  if (s.value === null || s.prior === null) {
    return <span className="text-[11px] text-lt-fg3">no prior period</span>
  }
  const diff = s.value - s.prior
  if (Math.abs(diff) < 0.005) {
    return <span className="text-[11px] text-lt-fg3">flat vs prior</span>
  }
  const up = diff > 0
  const better = s.betterHigher === null ? null : up === s.betterHigher
  const cls =
    better === null ? 'text-lt-fg3' : better ? 'text-chip-good-fg' : 'text-chip-bad-fg'
  return (
    <span className={`text-[11px] font-semibold ${cls}`}>
      {up ? '▲' : '▼'} {fmt(Math.abs(diff), s.unit)} vs prior
    </span>
  )
}

export default function TeamPage() {
  const [days, setDays] = useState(30)
  const [tab, setTab] = useState<Tab>('outcomes')
  const [reports, setReports] = useState<PersonReport[] | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/team/metrics?days=${days}`, { cache: 'no-store' })
      if (res.status === 401 || res.status === 403) {
        setForbidden(true)
        return
      }
      if (!res.ok) return
      const j = await res.json()
      setReports(j.reports)
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    void load()
  }, [load])

  if (forbidden) {
    return (
      <div className="bg-lt-page -m-3 min-h-[calc(100vh-3rem)] p-4 md:-m-4 md:p-6">
        <div className="mx-auto max-w-lg rounded-xl border border-lt-hairline bg-lt-card p-6">
          <h1 className="text-lg font-semibold text-lt-fg">Restricted</h1>
          <p className="mt-2 text-[13px] text-lt-fg2">
            This page holds performance judgements about named employees, so access is granted by
            name rather than by role.
          </p>
        </div>
      </div>
    )
  }

  const active = TABS.find(([k]) => k === tab)!

  return (
    <div className="bg-lt-page -m-3 min-h-[calc(100vh-3rem)] p-4 md:-m-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-5">
          <h1 className="text-2xl font-semibold text-lt-fg">Team</h1>
          <p className="mt-1 max-w-2xl text-[13.5px] text-lt-fg2">
            Each person against their own previous {days} days. Nobody is ranked against anybody
            else — Ana collects and the reps sell, so the two share no honest common number.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            {TABS.map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${
                  tab === k
                    ? 'border-lt-fg bg-lt-fg text-white'
                    : 'border-lt-hairline bg-lt-card text-lt-fg2 hover:border-lt-fg3'
                }`}
              >
                {label}
              </button>
            ))}
            <span className="ml-auto flex items-center gap-1.5">
              <span className="text-[11px] text-lt-fg3">Window</span>
              {WINDOWS.map(([d, label]) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`rounded-lg px-2 py-1 text-[11.5px] font-semibold ${
                    days === d ? 'bg-lt-inner text-lt-fg' : 'text-lt-fg3 hover:text-lt-fg'
                  }`}
                >
                  {label}
                </button>
              ))}
            </span>
          </div>
          <p className="mt-2 text-[12px] text-lt-fg3">{active[2]}</p>
        </header>

        {loading && <p className="text-[13px] text-lt-fg3">Reading…</p>}

        <div className="space-y-3">
          {(reports ?? []).map((p) => {
            const stats = p[tab]
            return (
              <section key={p.email} className="rounded-xl border border-lt-hairline bg-lt-card p-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h2 className="text-[15px] font-semibold text-lt-fg">{p.name}</h2>
                  <span className="rounded-md bg-chip-neutral-bg px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-chip-neutral-fg">
                    {p.kind === 'SALES' ? 'sales' : 'collections'}
                  </span>
                  <span className="text-[11.5px] text-lt-fg3">{p.email}</span>
                </div>

                {!p.hasUser && (
                  <p className="mt-2 rounded-lg bg-chip-warn-bg px-2.5 py-1.5 text-[11.5px] text-chip-warn-fg">
                    No HQ user account matches this address, so everything keyed to a user id is
                    unavailable — not zero. Only the email numbers below are real.
                  </p>
                )}

                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                  {stats.map((s) => (
                    <div key={s.key}>
                      <dt className="text-[10.5px] uppercase tracking-wide text-lt-fg3">{s.label}</dt>
                      <dd className="mt-0.5 text-[19px] font-bold text-lt-fg tabular-nums">
                        {fmt(s.value, s.unit)}
                      </dd>
                      <Delta s={s} />
                      {s.hint && <p className="mt-1 text-[10.5px] leading-snug text-lt-fg3">{s.hint}</p>}
                    </div>
                  ))}
                </dl>

                {p.caveat && (
                  <p className="mt-3 border-t border-lt-hairline pt-2 text-[11px] leading-snug text-lt-fg3">
                    {p.caveat}
                  </p>
                )}
              </section>
            )
          })}
        </div>

        <p className="mt-5 rounded-xl border border-lt-hairline bg-lt-inner p-3 text-[11.5px] leading-relaxed text-lt-fg2">
          <span className="font-semibold text-lt-fg">Read these as a floor.</span> Phone calls,
          anything done inside RentalWorks, walk-ups and every lead worked out of the shared
          info@/hello@ inboxes are invisible here. A low number is a question worth asking, not a
          finding on its own — and the fastest way to be wrong about somebody is to treat activity
          as achievement.
        </p>
      </div>
    </div>
  )
}
