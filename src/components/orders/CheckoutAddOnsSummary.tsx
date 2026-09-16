'use client'

/**
 * "Added at check-out" on the order page — the driver's last-minute extras,
 * collapsed into the order they belong to (Wes 2026-09-16). The lines are
 * ordinary lines in the table above; this says, in one place, that they came
 * from the driver at check-out, who added them, and which still need a price.
 */

import { useEffect, useState } from 'react'
import { PackagePlus } from 'lucide-react'

interface AddedLine {
  id: string
  description: string
  quantity: number
  lineTotal: number
  note: string | null
  addedAt: string
  addedBy: string | null
  unpriced: boolean
}

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

export function CheckoutAddOnsSummary({ orderId, refreshKey }: { orderId: string; refreshKey?: unknown }) {
  const [lines, setLines] = useState<AddedLine[] | null>(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const r = await fetch(`/api/orders/${orderId}/checkout-addons`)
      const j = await r.json().catch(() => ({}))
      if (!cancelled) setLines(r.ok ? j.added ?? [] : [])
    })()
    return () => {
      cancelled = true
    }
  }, [orderId, refreshKey])

  if (!lines || lines.length === 0) return null
  const unpriced = lines.filter((l) => l.unpriced).length
  return (
    <div className="rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2.5">
      <p className="flex items-center gap-2 text-[13px] font-semibold text-lt-fg">
        <PackagePlus size={14} aria-hidden className="flex-none text-lt-fg2" />
        Added at check-out — requested by the driver
        {unpriced > 0 && (
          <span className="ml-auto rounded-md bg-chip-warn-bg px-1.5 py-0.5 text-[11px] font-semibold text-chip-warn-fg">
            {unpriced} need{unpriced === 1 ? 's' : ''} a price
          </span>
        )}
      </p>
      <ul className="mt-1.5 ml-[22px] space-y-1">
        {lines.map((l) => (
          <li key={l.id} className="text-[13px] text-lt-fg">
            <span className="font-semibold">{l.quantity}×</span> {l.description}
            <span className="text-lt-fg2">
              {' '}· {l.unpriced ? 'needs a price' : `$${l.lineTotal.toFixed(2)}`} · {l.addedBy ? `${l.addedBy}, ` : ''}
              {fmtWhen(l.addedAt)}
            </span>
            {l.note && <div className="text-[12px] text-lt-fg3">{l.note}</div>}
          </li>
        ))}
      </ul>
    </div>
  )
}
