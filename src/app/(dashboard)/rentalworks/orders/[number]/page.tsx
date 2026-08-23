'use client'

/**
 * /rentalworks/orders/[number] — one RW order, rendered in HQ.
 *
 * The gantt's "RW #…" link lands here. It used to point at the jobs
 * LIST (Wes, 2026-08-22: "opens the job page, not the individual
 * order") — but RW's own web app has no per-record URLs to deep-link,
 * so the order is shown here from the live RW API instead (mirror
 * fallback when RW is down; `source` says which you're seeing).
 * Header-only by design: RW's item endpoints reject all server-side
 * filters, so a line-item table cannot be fetched truthfully.
 */

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface OrderView {
  ok: boolean
  orderNumber: string
  kind?: 'order' | 'quote'
  source: 'live' | 'mirror'
  order: {
    description: string | null
    customer: string | null
    deal: string | null
    status: string | null
    total: number | null
    orderDate: string | null
    estimatedStartDate: string | null
    estimatedEndDate: string | null
    officeLocation: string | null
    warehouse: string | null
    agent: string | null
  }
  error?: string
}

const money = (n: number | null) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const day = (s: string | null) => (s ? String(s).slice(0, 10) : '—')

export default function RwOrderPage() {
  const params = useParams()
  const number = String(params?.number ?? '')
  const [data, setData] = useState<OrderView | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!number) return
    fetch(`/api/rentalworks/orders/by-number/${encodeURIComponent(number)}`)
      .then(async (r) => {
        const j = (await r.json()) as OrderView
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
        setData(j)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [number])

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="text-xs text-zinc-500 mb-2">
        <Link href="/gantt" className="hover:underline">← Reservations</Link>
      </div>
      <h1 className="text-2xl font-semibold text-zinc-900">
        RW {data?.kind === 'quote' ? 'Quote' : 'Order'} #{number}
      </h1>
      <p className="text-sm text-zinc-600 mt-1 mb-6">
        RentalWorks billing record, read straight from RW. Line items aren&rsquo;t shown —
        RW&rsquo;s API can&rsquo;t serve them per-order — open RentalWorks for the full detail.
      </p>

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
      ) : !data ? (
        <div className="text-zinc-600 text-sm">Loading from RentalWorks…</div>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-xl divide-y divide-zinc-100">
          {[
            ['Customer', data.order.customer],
            ['Deal', data.order.deal],
            ['Description', data.order.description],
            ['Status', data.order.status],
            ['Order date', day(data.order.orderDate)],
            ['Rental window', `${day(data.order.estimatedStartDate)} → ${day(data.order.estimatedEndDate)}`],
            ['Agent', data.order.agent],
            ['Office / warehouse', [data.order.officeLocation, data.order.warehouse].filter(Boolean).join(' / ') || '—'],
            ['Total', money(data.order.total)],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex justify-between gap-6 px-4 py-2.5 text-sm">
              <span className="text-zinc-500">{label}</span>
              <span className="text-zinc-900 font-medium text-right">{value ?? '—'}</span>
            </div>
          ))}
          <div className="px-4 py-2.5 flex items-center justify-between">
            <span className="text-[11px] text-zinc-400">
              {data.source === 'live' ? 'Live from RentalWorks' : 'RW unreachable — showing last synced copy'}
            </span>
            <a
              href="https://sirreel.rentalworks.cloud/"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-600 hover:underline"
            >
              Open RentalWorks →
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
