'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * The live collections desk.
 *
 * Wes, 2026-09-14, on the first version: *"I want this to be positive and
 * encouraging, not big brother ish."*
 *
 * So the page opens on what the desk LANDED this month — money cleared,
 * invoices closed out, clients reached, the biggest single win — and only
 * then shows the live detail underneath. Same rows as before; the difference
 * is what the eye hits first, and that a page opening on "$12,812 collected,
 * 18 invoices closed" is a place you'd show someone their own work.
 *
 * What is deliberately absent, and why, is documented in
 * src/lib/collections/deskActivity.ts — chiefly per-person email counts,
 * which went out with that note from Wes.
 *
 * Polling, not sockets: the desk produces a handful of rows an hour, and a 45
 * second refresh is indistinguishable from live at that rate. The poll stops
 * while the tab is hidden.
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

interface DeskWins {
  collected: number
  previousMonth: number
  clearedFromAr: MoneyBucket
  invoicesClosed: number
  clientsReached: number
  biggest: { label: string; amount: number; at: string } | null
}

interface OperatorStat {
  key: string
  name: string
  charged: MoneyBucket
  collected: MoneyBucket
  deskDecisions: number
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
  wins: DeskWins
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
  PAID_MARK:     { label: 'Closed',    cls: 'bg-chip-neutral-bg text-chip-neutral-fg' },
  TRIAGE:        { label: 'Aging',     cls: 'bg-chip-warn-bg text-chip-warn-fg' },
  NOTE:          { label: 'Note',      cls: 'bg-chip-neutral-bg text-chip-neutral-fg' },
  REMITTANCE:    { label: 'Remittance',cls: 'bg-chip-warn-bg text-chip-warn-fg' },
}

type FeedFilter = 'all' | 'money' | 'outreach' | 'decisions'

const FILTERS: { key: FeedFilter; label: string }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'money', label: 'Money in' },
  { key: 'outreach', label: 'Client contact' },
  { key: 'decisions', label: 'Desk work' },
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

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** A win tile. Big number, plain label, no target to fall short of. */
function Win({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div className="rounded-lg bg-lt-inner px-4 py-3">
      <div className="text-[22px] font-semibold text-lt-fg tabular-nums leading-tight">{value}</div>
      <div className="text-[12px] text-lt-fg2">{label}</div>
      {note ? <div className="text-[11px] text-lt-fg3 mt-0.5">{note}</div> : null}
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
          : w.key === 'today'
            ? 'nothing in yet today'
            : 'nothing collected in this stretch'}
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
        <span className="text-lt-fg2">Follow-ups logged</span>
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

export function DeskActivityPanel({ viewerName }: { viewerName?: string }) {
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

  const { wins } = data
  const today = data.windows.find((w) => w.key === 'today')
  const staleInbox = data.inboxes.find((i) => i.stale)
  const delta = wins.collected - wins.previousMonth
  const ahead = wins.previousMonth > 0 && delta > 0

  return (
    <div className="space-y-4">
      {/* ── What the month has landed ─────────────────────────────── */}
      <div className="rounded-lg border border-lt-hairline bg-lt-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[13px] font-semibold text-lt-fg">Landed in the last 30 days</h2>
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

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Win
            value={usd(wins.collected)}
            label="collected through HQ"
            note={
              wins.previousMonth > 0
                ? ahead
                  ? `${usdShort(delta)} ahead of the month before`
                  : `${usdShort(Math.abs(delta))} behind the month before (${usdShort(wins.previousMonth)})`
                : undefined
            }
          />
          <Win
            value={usd(wins.clearedFromAr.amount)}
            label="cleared from AR"
            note={`${wins.clearedFromAr.count} invoice${wins.clearedFromAr.count === 1 ? '' : 's'} marked paid in RentalWorks`}
          />
          <Win value={String(wins.invoicesClosed)} label="invoices closed out" />
          <Win value={String(wins.clientsReached)} label="clients reached" note="by email from the desk" />
        </div>

        {wins.biggest ? (
          <div className="mt-3 rounded-lg bg-chip-good-bg px-3 py-2 text-[12px] text-chip-good-fg">
            Biggest of the month: <strong>{usd(wins.biggest.amount)}</strong> from{' '}
            {wins.biggest.label} on {shortDate(wins.biggest.at)}.
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-lt-hairline pt-3 text-[12px] text-lt-fg2">
          <span>
            In today: <strong className="text-lt-fg tabular-nums">{usd(today?.money.total ?? 0)}</strong>
          </span>
          <span>
            Still out there:{' '}
            <strong className="text-lt-fg tabular-nums">{usd(data.openAr.total)}</strong> across{' '}
            {data.openAr.count} invoice{data.openAr.count === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {staleInbox ? (
        <div className="rounded-lg bg-chip-warn-bg px-3 py-2 text-[12px] text-chip-warn-fg">
          Heads up: {staleInbox.address}&rsquo;s Gmail watch has not renewed since{' '}
          {staleInbox.watchedAt ? shortDate(staleInbox.watchedAt) : 'ever'}. Client emails
          will be undercounted here until it does — the desk is doing more than this page
          can see.
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        {data.windows.map((w) => (
          <WindowCard key={w.key} w={w} />
        ))}
      </div>

      <div className="rounded-lg border border-lt-hairline bg-lt-card">
        <div className="border-b border-lt-hairline px-4 py-2.5 text-[12px] font-semibold text-lt-fg">
          Credit where it&rsquo;s due · last 30 days
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-lt-fg3">
              <th className="px-4 py-2 text-left font-medium">Who</th>
              <th className="px-4 py-2 text-right font-medium">Cards taken</th>
              <th className="px-4 py-2 text-right font-medium">Other money in</th>
              <th className="px-4 py-2 text-right font-medium">Follow-ups logged</th>
            </tr>
          </thead>
          <tbody>
            {data.operators.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-4 text-center text-[12px] text-lt-fg3">
                  Nothing recorded in the last 30 days.
                </td>
              </tr>
            ) : (
              data.operators.map((o) => {
                const isViewer = !!viewerName && o.name === viewerName
                return (
                  <tr key={o.key} className={`border-t border-lt-hairline ${isViewer ? 'bg-lt-inner2' : ''}`}>
                    <td className="px-4 py-2 text-lt-fg">
                      {o.name}
                      {isViewer ? <span className="ml-1.5 text-[11px] text-lt-fg3">you</span> : null}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-lt-fg">
                      {o.charged.count ? usd(o.charged.amount) : <span className="text-lt-fg3">—</span>}
                      {o.charged.count ? <span className="text-lt-fg3"> ({o.charged.count})</span> : null}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-lt-fg">
                      {o.collected.count ? usd(o.collected.amount) : <span className="text-lt-fg3">—</span>}
                      {o.collected.count ? <span className="text-lt-fg3"> ({o.collected.count})</span> : null}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-lt-fg2">{o.deskDecisions || '—'}</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
        <div className="border-t border-lt-hairline px-4 py-2 text-[11px] text-lt-fg3">
          Only outcomes are listed here — money in and follow-ups logged. Emails are counted
          for the desk, never per person. Most of the work that clears an invoice is a phone
          call HQ never sees, so a short row is not a short day.
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
