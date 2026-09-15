'use client'

import { useState } from 'react'
import { compactMoney } from '@/lib/exec/format'

/**
 * A single-series column chart for the owner numbers page.
 *
 * HTML rather than SVG so axis text stays crisp and legible at phone width
 * instead of scaling with a viewBox. One series only — the section heading
 * names it, so there is no legend.
 *
 * `value: null` is NO DATA (e.g. a week before collections tracking began) and
 * renders as an empty band with a dash, never as a zero-height bar: "we did not
 * measure" and "nothing came in" must not look the same.
 *
 * `muted` bars are real but incomplete — the month in progress, or a week from
 * before HQ held the whole order book — and draw in a lighter step so the eye
 * does not read them as a drop.
 */

export interface Column {
  key: string
  /** Axis label under the band. */
  label: string
  value: number | null
  muted?: boolean
  /** Tooltip lines after the value. */
  detail?: string[]
}

const ACCENT = '#0F7A93'
const ACCENT_MUTED = '#9CCBD6'

function niceMax(max: number): number {
  if (max <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(max))
  // Fine steps so the tallest bar uses most of the plot (a 56 peak tops out
  // at 60, not 100).
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (step * pow >= max) return step * pow
  }
  return 10 * pow
}

export function ColumnChart({
  columns,
  format,
  height = 160,
}: {
  columns: Column[]
  format: 'money' | 'count'
  height?: number
}) {
  const [hover, setHover] = useState<string | null>(null)
  const fmt = (n: number) => (format === 'money' ? compactMoney(n) : n.toLocaleString('en-US'))
  const max = niceMax(Math.max(0, ...columns.map((c) => c.value ?? 0)))
  const ticks = [max, max / 2, 0]
  const last = [...columns].reverse().find((c) => c.value !== null)

  return (
    <div className="relative">
      <div className="flex">
        {/* y-axis */}
        <div className="relative w-12 shrink-0" style={{ height }}>
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-lt-fg3"
              style={{ top: `${(1 - t / max) * 100}%` }}
            >
              {fmt(t)}
            </span>
          ))}
        </div>

        {/* plot */}
        <div className="relative flex-1" style={{ height }}>
          {ticks.map((t) => (
            <div
              key={t}
              className="absolute inset-x-0 border-t border-lt-hairline"
              style={{ top: `${(1 - t / max) * 100}%` }}
            />
          ))}
          <div className="absolute inset-0 flex items-end">
            {columns.map((c, i) => {
              const pct = c.value === null ? 0 : Math.max(0, (c.value / max) * 100)
              const active = hover === c.key
              return (
                <div
                  key={c.key}
                  className="relative flex h-full flex-1 cursor-default items-end justify-center"
                  onMouseEnter={() => setHover(c.key)}
                  onMouseLeave={() => setHover((h) => (h === c.key ? null : h))}
                  onClick={() => setHover((h) => (h === c.key ? null : c.key))}
                >
                  {active && <div className="absolute inset-0 bg-lt-inner/60" />}
                  {c.value === null ? (
                    <span className="relative mb-1 text-[11px] text-lt-fg3">—</span>
                  ) : (
                    <div
                      className="relative w-[60%] max-w-[24px] rounded-t"
                      style={{
                        height: `${pct}%`,
                        minHeight: c.value > 0 ? 2 : 0,
                        background: c.muted ? ACCENT_MUTED : ACCENT,
                      }}
                    />
                  )}
                  {c === last && c.value !== null && !active && (
                    <span
                      className="absolute whitespace-nowrap text-[11px] font-medium tabular-nums text-lt-fg"
                      style={{ bottom: `calc(${pct}% + 4px)` }}
                    >
                      {fmt(c.value)}
                    </span>
                  )}
                  {active && (
                    <div
                      className={`absolute z-10 min-w-[120px] whitespace-nowrap rounded border border-lt-hairline bg-lt-card px-2.5 py-1.5 text-left shadow-md ${
                        // Pinned to the band's edge near the ends so it never leaves the card.
                        i < 2 ? 'left-0' : i > columns.length - 3 ? 'right-0' : 'left-1/2 -translate-x-1/2'
                      }`}
                      style={{ bottom: `calc(${pct}% + 8px)` }}
                    >
                      <div className="text-[11px] text-lt-fg3">{c.label}</div>
                      <div className="text-[13px] font-semibold tabular-nums text-lt-fg">
                        {c.value === null ? 'No data' : fmt(c.value)}
                      </div>
                      {c.detail?.map((d) => (
                        <div key={d} className="text-[11px] text-lt-fg2">
                          {d}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* x-axis — every other label when crowded, counted back from the latest */}
      <div className="ml-12 mt-1 flex">
        {columns.map((c, i) => (
          // A shown label may spill into its blank neighbour's band, so it is
          // centred absolutely rather than truncated to one narrow band.
          <span key={c.key} className="relative h-4 flex-1">
            {!(columns.length > 8 && (columns.length - 1 - i) % 2 === 1) && (
              <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] text-lt-fg3">
                {c.label}
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}
