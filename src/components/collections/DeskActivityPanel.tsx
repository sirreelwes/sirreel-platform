'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * The live collections desk.
 *
 * Wes, 2026-09-14: he wanted to see the collections numbers arrive and the
 * outreach happen, without waiting for the 6pm report or asking the person
 * doing the work. The reasoning about WHAT is counted — and what is
 * deliberately not — lives in src/lib/collections/deskActivity.ts.
 *
 * Polling, not sockets: the desk produces a handful of rows an hour, and a 45
 * second refresh is indistinguishable from live at that rate. The poll stops
 * while the tab is hidden, so a page left open overnight isn't hammering the
 * DB from a background tab.
 */

interface MoneyBucket { amount: number; count: number }

interface DeskWindow {
  key: 'today' | 'week' | 'month'
  label: string
  money: { card: MoneyBucket; bank: MoneyBucket; hq: MoneyBucket; total: number }
  outreach: {
    emailsSent: number
    byMailbox: { address: string; label: string; sent: number }[]
    recipients: number
    emailsIn: number
    invoicesEmailed: number
    deskDecisions: number
    clientAnswers: number
  }
}

interface OperatorStat {
  key: string
  name: string
  charged: MoneyBucket
  collected: MoneyBucket
  deskDecisions: number
  emailsSent: number
}

type DeskEventKind =
  | 'CHARGE' | 'REVERSAL' | 'COLLECTED' | 'PAYMENT' | 'EMAIL'
  | 'INVOICE_SENT' | 'PAID_MARK' | 'TRIAGE' | 'NOTE' | 'REMITTANCE' | 'CLIENT_ANSWER'

interface DeskEvent {
  at: string
  kind: DeskEventKind
  who: string | null
  title: string
  detail: string | null
  amount: number | null
}

interface DeskData {
  generatedAt: string
  openAr: { total: number; count: number }
  windows: DeskWindow[]
  operators: OperatorStat[]
  feed: DeskEvent[]
  inboxes: { address: string; watchedAt: string | null; stale: boolean }[]
}

const REFRESH_MS = 45_000

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const usdShort = (n: number) =>
  n >= 1000
    ? `$${(n / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}K`
    : `$${n.toFixed(0)}`

/** MONEY events are the outcome; the rest is the work that produced it. */
const MONEY_KINDS: ReadonlySet<DeskEventKind> = new Set([
  'CHARGE', 'COLLECTED', 'PAYMENT', 'REVERSAL',
])
const OUTREACH_KINDS: ReadonlySet<DeskEventKind> = new Set([
  'EMAIL', 'INVOICE_SENT', 'CLIENT_ANSWER',
])

const KIND_META: Record<DeskEventKind, { label: string; cls: string }> = {
  CHARGE:        { label: 'Card',      cls: 'bg-chip-good-bg text-chip-good-fg' },
  COLLECTED:     { label: 'Collected', cls: 'bg-chip-good-bg text-chip-good-fg' },
  PAYMENT:       { label: 'Payment',   cls: 'bg-chip-good-bg text-chip-good-fg' },
  REVERSAL:      { label: 'Reversal',  cls: 'bg-chip-bad-bg text-chip-bad-fg' },
  EMAIL:         { label: 'Email',     cls: 'bg-cadence-booked-bg text-cadence-booked-fg' },
  INVOICE_SENT:  { label: 'Invoice',   cls: 'bg-cadence-booked-bg text-cadence-booked-fg' },
  CLIENT_ANSWER: { label: 'Client',    cls: 'bg-cadence-returned-bg text-cadence-returned-fg' },
  PAID_MARK:     { label: 'Paid mark', cls: 'bg-chip-neutral-bg text-chip-neutral-fg' },
  TRIAGE:        { label: 'Aging',     cls: 'bg-chip-warn-bg text-chip-warn-fg' },
  NOTE:          { label: 'Note',      cls: 'bg-chip-neutral-bg text-chip-neutral-fg' },
  REMITTANCE:    { label: 'Remittance',cls: 'bg-chip-warn-bg text-chip-warn-fg' },
}

type FeedFilter = 'all' | 'money' | 'outreach' | 'decisions'

const FILTERS: { key: FeedFilter; label: string }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'money', label: 'Money in' },
  { key: 'outreach', label: 'Outreach' },
  { key: 'decisions', label: 'Desk calls' },
]

function when(iso: string, now: number): string {
  const t = new Date(iso)
  const mins = Math.round((now - t.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const sameDay = new Date(now).toDateString() === t.toDateString()
  if (sameDay) return t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-lt-fg3">{label}</div>
      <div className="text-[20px] font-semibold text-lt-fg tabular-nums">{value}</div>
      {sub ? <div className="text-[11px] text-lt-fg3">{sub}</div> : null}
    </div>
  )
}

function WindowCard({ w }: { w: DeskWindow }) {
  const parts = [
    { label: 'Card', b: w.money.card },
    { label: 'Bank', b: w.money.bank },
    { label: 'HQ invoices', b: w.money.hq },
  ].filter((p) => p.b.count > 0)

  return (
    <div className="rounded-lg border border-lt-hairline bg-lt-card p-4">
      <div className="text-[11px] uppercase tracking-wide text-lt-fg3">{w.label}</div>
      <div className="mt-1 text-[26px] font-semibold text-lt-fg tabular-nums">
        {usd(w.money.total)}
      </div>
      <div className="mt-0.5 text-[12px] text-lt-fg3">
        {parts.length
          ? parts.map((p) => `${p.label} ${usdShort(p.b.amount)} (${p.b.count})`).join(' · ')
          : 'nothing collected yet'}
      </div>

      <div className="mt-3 border-t border-lt-hairline pt-3 grid grid-cols-2 gap-y-1.5 text-[12px]">
        <span className="text-lt-fg2">Client emails</span>
        <span className="text-right tabular-nums text-lt-fg">
          {w.outreach.emailsSent}
          {w.outreach.recipients > 0 ? (
            <span className="text-lt-fg3"> · {w.outreach.recipients} address{w.outreach.recipients === 1 ? '' : 'es'}</span>
          ) : null}
        </span>
        <span className="text-lt-fg2">Invoices sent</span>
        <span className="text-right tabular-nums text-lt-fg">{w.outreach.invoicesEmailed}</span>
        <span className="text-lt-fg2">Desk calls logged</span>
        <span className="text-right tabular-nums text-lt-fg">{w.outreach.deskDecisions}</span>
        <span className="text-lt-fg2">Clients answered</span>
        <span className="text-right tabular-nums text-lt-fg">{w.outreach.clientAnswers}</span>
      </div>

      {w.outreach.byMailbox.length > 0 ? (
        <div className="mt-2 text-[11px] text-lt-fg3">
          {w.outreach.byMailbox.map((b) => `${b.label} ${b.sent}`).join(' · ')}
        </div>
      ) : null}
    </div>
  )
}

export function DeskActivityPanel() {
  const [data, setData] = useState<DeskData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FeedFilter>('all')
  const [now, setNow] = useState(() => Date.now())
  const loading = useRef(false)

  const load = useCallback(async () => {
    if (loading.current) return
    loading.current = true
    try {
      const r = await fetch('/api/collections/desk', { cache: 'no-store' })
      if (!r.ok) {
        setError(r.status === 403 ? 'You do not have access to the desk view.' : 'That did not load.')
        return
      }
      setData((await r.json()) as DeskData)
      setError(null)
      setNow(Date.now())
    } catch {
      setError('That did not load.')
    } finally {
      loading.current = false
    }
  }, [])

  useEffect(() => {
    void load()
    const tick = setInterval(() => {
      // A hidden tab is nobody watching — don't poll into the void.
      if (document.visibilityState === 'visible') void load()
    }, REFRESH_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(tick)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  const feed = useMemo(() => {
    if (!data) return []
    if (filter === 'all') return data.feed
    if (filter === 'money') return data.feed.filter((e) => MONEY_KINDS.has(e.kind))
    if (filter === 'outreach') return data.feed.filter((e) => OUTREACH_KINDS.has(e.kind))
    return data.feed.filter((e) => !MONEY_KINDS.has(e.kind) && !OUTREACH_KINDS.has(e.kind))
  }, [data, filter])

  if (error && !data) {
    return <div className="rounded-lg border border-lt-hairline bg-lt-card p-6 text-[13px] text-lt-fg2">{error}</div>
  }
  if (!data) {
    return <div className="rounded-lg border border-lt-hairline bg-lt-card p-6 text-[13px] text-lt-fg3">Loading the desk…</div>
  }

  const today = data.windows.find((w) => w.key === 'today')
  const month = data.windows.find((w) => w.key === 'month')
  const staleInbox = data.inboxes.find((i) => i.stale)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-6">
          <Stat
            label="Open AR"
            value={usd(data.openAr.total)}
            sub={`${data.openAr.count} invoice${data.openAr.count === 1 ? '' : 's'} still owed`}
          />
          <Stat
            label="In today"
            value={usd(today?.money.total ?? 0)}
            sub={`${today?.outreach.emailsSent ?? 0} emails out today`}
          />
          <Stat
            label="Last 30 days"
            value={usd(month?.money.total ?? 0)}
            sub={`${month?.outreach.emailsSent ?? 0} emails out · ${month?.outreach.emailsIn ?? 0} in`}
          />
        </div>
        <div className="flex items-center gap-2 text-[11px] text-lt-fg3">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
          live · updated {when(data.generatedAt, now)}
          <button
            onClick={() => void load()}
            className="ml-1 rounded border border-lt-hairline px-2 py-0.5 text-lt-fg2 hover:bg-lt-inner"
          >
            Refresh
          </button>
        </div>
      </div>

      {staleInbox ? (
        <div className="rounded-lg bg-chip-warn-bg px-3 py-2 text-[12px] text-chip-warn-fg">
          {staleInbox.address}&rsquo;s Gmail watch has not renewed since{' '}
          {staleInbox.watchedAt
            ? new Date(staleInbox.watchedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : 'ever'}
          . Emails sent may be undercounted until it does — a quiet feed is not
          proof of a quiet desk.
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        {data.windows.map((w) => (
          <WindowCard key={w.key} w={w} />
        ))}
      </div>

      <div className="rounded-lg border border-lt-hairline bg-lt-card">
        <div className="border-b border-lt-hairline px-4 py-2.5 text-[12px] font-semibold text-lt-fg">
          Who did what · last 30 days
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-lt-fg3">
              <th className="px-4 py-2 text-left font-medium">Operator</th>
              <th className="px-4 py-2 text-right font-medium">Cards taken</th>
              <th className="px-4 py-2 text-right font-medium">Other collected</th>
              <th className="px-4 py-2 text-right font-medium">Desk calls</th>
              <th className="px-4 py-2 text-right font-medium">Emails sent</th>
            </tr>
          </thead>
          <tbody>
            {data.operators.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-center text-[12px] text-lt-fg3">
                  Nothing recorded in the last 30 days.
                </td>
              </tr>
            ) : (
              data.operators.map((o) => (
                <tr key={o.key} className="border-t border-lt-hairline">
                  <td className="px-4 py-2 text-lt-fg">{o.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-lt-fg">
                    {o.charged.count ? `${usd(o.charged.amount)}` : <span className="text-lt-fg3">—</span>}
                    {o.charged.count ? <span className="text-lt-fg3"> ({o.charged.count})</span> : null}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-lt-fg">
                    {o.collected.count ? `${usd(o.collected.amount)}` : <span className="text-lt-fg3">—</span>}
                    {o.collected.count ? <span className="text-lt-fg3"> ({o.collected.count})</span> : null}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-lt-fg2">{o.deskDecisions || '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-lt-fg2">{o.emailsSent || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="border-t border-lt-hairline px-4 py-2 text-[11px] text-lt-fg3">
          Dollars are the outcome; emails and desk calls are evidence of effort,
          not a score. Phone calls never reach HQ, so a light column is not an
          idle day. Mail sent from the shared billing@ and payments@ boxes goes
          out as &ldquo;SirReel Billing&rdquo; with no person on the envelope —
          it counts in the desk totals above, and is left out of this table
          rather than attributed by guess.
        </div>
      </div>

      <div className="rounded-lg border border-lt-hairline bg-lt-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-lt-hairline px-4 py-2.5">
          <span className="text-[12px] font-semibold text-lt-fg">As it happens</span>
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded px-2 py-1 text-[11px] ${
                  filter === f.key
                    ? 'bg-lt-fg text-white'
                    : 'border border-lt-hairline text-lt-fg2 hover:bg-lt-inner'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <ul className="divide-y divide-lt-hairline">
          {feed.length === 0 ? (
            <li className="px-4 py-4 text-center text-[12px] text-lt-fg3">Nothing here yet.</li>
          ) : (
            feed.map((e, i) => {
              const meta = KIND_META[e.kind]
              return (
                <li key={`${e.at}-${i}`} className="flex items-start gap-3 px-4 py-2.5">
                  <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.cls}`}>
                    {meta.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-lt-fg">{e.title}</div>
                    {e.detail ? (
                      <div className="truncate text-[11px] text-lt-fg3">{e.detail}</div>
                    ) : null}
                  </div>
                  {e.amount ? (
                    <span className="shrink-0 text-[13px] tabular-nums text-lt-fg">{usd(e.amount)}</span>
                  ) : null}
                  <span className="w-28 shrink-0 text-right text-[11px] text-lt-fg3">
                    {e.who ? <span className="block truncate text-lt-fg2">{e.who}</span> : null}
                    {when(e.at, now)}
                  </span>
                </li>
              )
            })
          )}
        </ul>
      </div>
    </div>
  )
}
