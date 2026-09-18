'use client'

/**
 * The day's orders and quotes, counted the way the EOD report counts them.
 *
 * Ana, 2026-09-17: "confirm how many orders and quotes were created each day …
 * That way I know if the EOD report that gets generated is accurate or not."
 *
 * So this card's job is NOT to describe the table under it — the table answers
 * to whatever the rep has filtered. It renders `tallyOrderDay`, the same pure
 * function src/lib/collections/eodReport.ts renders into the evening email, and
 * says out loud where the two views of the same day part company. A card that
 * quietly counted only the visible rows would be the one thing worse than no
 * card: a confirmation that agrees with nothing.
 *
 * Money is gated like every other figure on this page (Wes 2026-09-03) — the
 * counts still read for a viewer without seePricing, because "six quotes went
 * out" is not a price.
 */

import { useMoneyFormatter, useMoneyVisible } from '@/hooks/useMoney'
import { reconciliationNote, type DayTally } from '@/lib/orders/dayTally'

export type DayTallyPayload = DayTally & { from: string; to: string }

/** "Sep 17" / "Sep 15 – Sep 17". Parsed as a plain date, never a UTC instant. */
function rangeLabel(from: string, to: string): string {
  const show = (ymd: string) => {
    const [y, m, d] = ymd.split('-').map(Number)
    return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
  }
  return from === to ? show(from) : `${show(from)} – ${show(to)}`
}

export function OrdersDayTallyCard({ tally }: { tally: DayTallyPayload }) {
  const fmt = useMoneyFormatter({ maximumFractionDigits: 2 })
  const canSeeMoney = useMoneyVisible()
  const note = reconciliationNote(tally)
  const rows = tally.orders.count + tally.quotes.count

  return (
    <div className="mb-6 rounded-xl border border-lt-hairline bg-lt-card px-4 py-3">
      <div className="flex items-baseline gap-2 flex-wrap mb-3">
        <span className="text-[11px] font-bold uppercase tracking-wider text-lt-fg2">
          Created {rangeLabel(tally.from, tally.to)}
        </span>
        <span className="text-[11px] text-lt-fg3">
          {rows} order{rows === 1 ? '' : 's'} &amp; quote{rows === 1 ? '' : 's'} · the same
          figures tonight&apos;s EOD report uses
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile
          label="Orders"
          hint="On the books"
          count={tally.orders.count}
          amount={tally.orders.amount}
          canSeeMoney={canSeeMoney}
          fmt={fmt}
        />
        <Tile
          label="Quotes"
          hint="Still out"
          count={tally.quotes.count}
          amount={tally.quotes.amount}
          canSeeMoney={canSeeMoney}
          fmt={fmt}
        />
        <Tile
          label="Together"
          hint="Orders + quotes"
          count={rows}
          amount={tally.total}
          canSeeMoney={canSeeMoney}
          fmt={fmt}
          emphasis
        />
      </div>

      {note && <p className="mt-3 text-[11px] text-lt-fg3 leading-relaxed">{note}</p>}
    </div>
  )
}

function Tile({
  label,
  hint,
  count,
  amount,
  canSeeMoney,
  fmt,
  emphasis = false,
}: {
  label: string
  hint: string
  count: number
  amount: number
  canSeeMoney: boolean
  fmt: (v: string | number | null | undefined) => string
  emphasis?: boolean
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        emphasis ? 'border-lt-fg3 bg-lt-inner' : 'border-lt-hairline bg-lt-inner'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-lt-fg3">{label}</span>
        <span className="text-[10px] text-lt-fg3">{hint}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold text-lt-fg tabular-nums">{count}</span>
        {canSeeMoney && (
          <span className="font-mono text-sm text-lt-fg2 truncate">{fmt(amount)}</span>
        )}
      </div>
    </div>
  )
}
