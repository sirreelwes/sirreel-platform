'use client'

/**
 * /sub-rentals — Phase 1 read-only list.
 *
 * Hits GET /api/sub-rentals (ordered status ASC → endDate ASC) and
 * paints a table. The endpoint returns vendor + order + line so the
 * row links back to the source order with the rep can edit the
 * sub-rental from the line-detail modal.
 *
 * This becomes the returns board in Phase 3 — filters (status,
 * vendor, due-by date), per-row "Receive from vendor" / "Mark
 * returned" actions, an "overdue" pin. None of that lands today.
 *
 * Auth: layout's nav gate keeps non-Permissions.subRentals roles
 * out; the API double-checks on its own.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'

type SubRentalStatus =
  | 'REQUESTED' | 'CONFIRMED' | 'PICKED_UP' | 'ON_RENT' | 'RETURNED' | 'CANCELLED'

interface Row {
  id: string
  status: SubRentalStatus
  receiveMethod: 'PICKUP' | 'DELIVERY' | null
  itemDescription: string
  quantity: number
  startDate: string | null
  endDate: string | null
  vendorTotal: string | null
  clientTotal: string | null
  poNumber: string | null
  vendor: { id: string; name: string }
  order: { id: string; orderNumber: string; description: string | null } | null
  orderLineItem: { id: string; description: string } | null
}

const STATUS_COLORS: Record<SubRentalStatus, string> = {
  REQUESTED: 'bg-zinc-200 text-zinc-700',
  CONFIRMED: 'bg-blue-100 text-blue-800',
  PICKED_UP: 'bg-indigo-100 text-indigo-800',
  ON_RENT:   'bg-amber-100 text-amber-800',
  RETURNED:  'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-zinc-100 text-zinc-400 line-through',
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return d.slice(0, 10)
}

function fmtMoney(v: string | null): string {
  if (v == null) return '—'
  const n = Number(v)
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '—'
}

function margin(row: Row): number | null {
  if (row.vendorTotal == null || row.clientTotal == null) return null
  return Number(row.clientTotal) - Number(row.vendorTotal)
}

export default function SubRentalsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/sub-rentals', { cache: 'no-store' })
        if (r.status === 403) {
          if (!cancelled) setError('Admin / Sales-Director / GM access required.')
          return
        }
        const j = await r.json()
        if (!cancelled) setRows(j.subRentals ?? [])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'load failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sub-rentals</h1>
          <p className="text-sm text-gray-500 mt-1">
            Internal — equipment SirReel rents from partner vendors to fulfill client orders.
            Never surfaced on client-facing docs.
          </p>
        </div>
      </div>

      {error && (
        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 mb-4">
          {error}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-sm text-gray-500 text-center">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-sm text-gray-500 text-center">
            No sub-rentals yet. Open any order, hit “Sub-rent…” on a line.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Vendor</th>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-center">Qty</th>
                <th className="px-3 py-2">Receive</th>
                <th className="px-3 py-2">Pickup</th>
                <th className="px-3 py-2">Return-by</th>
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2 text-right">Vendor</th>
                <th className="px-3 py-2 text-right">Client</th>
                <th className="px-3 py-2 text-right">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => {
                const m = margin(row)
                return (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${STATUS_COLORS[row.status]}`}>
                        {row.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium text-gray-900">{row.vendor.name}</td>
                    <td className="px-3 py-2 text-gray-700">{row.itemDescription}</td>
                    <td className="px-3 py-2 text-center text-gray-700">{row.quantity}</td>
                    <td className="px-3 py-2 text-gray-700 text-xs">
                      {row.receiveMethod ? row.receiveMethod.toLowerCase() : '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-700 text-xs">{fmtDate(row.startDate)}</td>
                    <td className="px-3 py-2 text-gray-700 text-xs">{fmtDate(row.endDate)}</td>
                    <td className="px-3 py-2">
                      {row.order ? (
                        <Link
                          href={`/orders/${row.order.id}`}
                          className="text-blue-700 hover:underline font-mono text-xs"
                        >
                          {row.order.orderNumber}
                        </Link>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700">{fmtMoney(row.vendorTotal)}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700">{fmtMoney(row.clientTotal)}</td>
                    <td className={`px-3 py-2 text-right font-mono ${m != null && m < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                      {m == null ? '—' : `${m >= 0 ? '+' : ''}${fmtMoney(String(m))}`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
