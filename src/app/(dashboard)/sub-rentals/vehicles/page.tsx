'use client'

/**
 * /sub-rentals/vehicles — the subcontracted-vehicle roster.
 *
 * Persistent catalog of partner-owned production vehicles (King Kong
 * PV etc.) that sales can quote out: the vendor's list-rate structure
 * plus SirReel's negotiated discount, with the net cost derived per
 * row. Sales/billing/admin only — the API 403s fleet-side roles, and
 * this page renders that as the same friendly notice /sub-rentals
 * uses.
 *
 * Rows link to /sub-rentals/vehicles/[id] — the per-vehicle page.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { fmtMoney, netCost } from '@/lib/sub-rentals/vehicles'

interface VehicleRow {
  id: string
  name: string
  vehicleType: string | null
  isActive: boolean
  listDailyRate: string | null
  listWeeklyRate: string | null
  listMonthlyRate: string | null
  discountPercent: string | null
  vendor: { id: string; name: string }
}

interface VendorOpt { id: string; name: string }

function AddVehicleModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [vendors, setVendors] = useState<VendorOpt[]>([])
  const [vendorId, setVendorId] = useState('')
  const [vendorName, setVendorName] = useState('')
  const [name, setName] = useState('')
  const [vehicleType, setVehicleType] = useState('')
  const [daily, setDaily] = useState('')
  const [weekly, setWeekly] = useState('')
  const [monthly, setMonthly] = useState('')
  const [discount, setDiscount] = useState('')
  const [rateNotes, setRateNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/vendors', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setVendors((j.vendors ?? []).map((v: VendorOpt) => ({ id: v.id, name: v.name }))))
      .catch(() => {})
  }, [])

  const submit = async () => {
    if (!name.trim()) { setError('Vehicle name is required.'); return }
    if (!vendorId && !vendorName.trim()) { setError('Pick an owner or type a new one.'); return }
    setSaving(true)
    setError(null)
    try {
      const r = await fetch('/api/sub-rentals/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorId: vendorId || null,
          vendorName: vendorId ? null : vendorName.trim(),
          name: name.trim(),
          vehicleType: vehicleType.trim() || null,
          listDailyRate: daily.trim() || null,
          listWeeklyRate: weekly.trim() || null,
          listMonthlyRate: monthly.trim() || null,
          discountPercent: discount.trim() || null,
          rateNotes: rateNotes.trim() || null,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? `create failed (${r.status})`)
      onCreated(j.vehicle.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'create failed')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-16 px-4" onClick={onClose}>
      <div
        className="max-h-[85vh] supports-[max-height:85svh]:max-h-[85svh] overflow-y-auto bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-lg p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-gray-900 mb-4">Add subcontracted vehicle</h2>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Owner (vendor)</label>
            <select
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            >
              <option value="">— new vendor —</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            {!vendorId && (
              <input
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                placeholder="e.g. King Kong Production Vehicles"
                className="mt-1.5 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Vehicle name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. 2-Room Star Wagon"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Type</label>
              <input
                value={vehicleType}
                onChange={(e) => setVehicleType(e.target.value)}
                placeholder="e.g. Star Trailer"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Their list rates ($)</label>
            <div className="grid grid-cols-3 gap-3">
              <input value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="Daily" inputMode="decimal" className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
              <input value={weekly} onChange={(e) => setWeekly(e.target.value)} placeholder="Weekly" inputMode="decimal" className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
              <input value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="Monthly" inputMode="decimal" className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Our discount (%)</label>
            <input
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              placeholder="e.g. 25"
              inputMode="decimal"
              className="w-32 border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Rate structure notes</label>
            <textarea
              value={rateNotes}
              onChange={(e) => setRateNotes(e.target.value)}
              rows={2}
              placeholder="3-day week, delivery fees, fuel, minimums…"
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
          </div>
        </div>

        {error && (
          <div className="mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="px-3 py-1.5 text-sm rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Add vehicle'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SubcontractedVehiclesPage() {
  const router = useRouter()
  const [rows, setRows] = useState<VehicleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/sub-rentals/vehicles', { cache: 'no-store' })
      if (r.status === 403) {
        setError('Sales / billing / admin access required — this roster carries vendor pricing.')
        return
      }
      const j = await r.json()
      setRows(j.vehicles ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <div className="text-xs text-gray-400 mb-0.5">
            <Link href="/sub-rentals" className="hover:underline">Sub-rentals</Link>
            {' / '}Vehicles
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Subcontracted Vehicles</h1>
          <p className="text-sm text-gray-500 mt-1">
            Partner-owned production vehicles we can quote out — their price structure and our
            negotiated discount. Internal only, never on client-facing docs.
          </p>
        </div>
        {!error && (
          <button
            onClick={() => setShowAdd(true)}
            className="px-3 py-1.5 text-sm rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold shrink-0"
          >
            + Add vehicle
          </button>
        )}
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
          !error && (
            <div className="p-8 text-sm text-gray-500 text-center">
              No subcontracted vehicles yet. Hit “+ Add vehicle” to put the first one on the roster.
            </div>
          )
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
                <th className="px-3 py-2">Vehicle</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2 text-right">List / day</th>
                <th className="px-3 py-2 text-right">List / week</th>
                <th className="px-3 py-2 text-right">Discount</th>
                <th className="px-3 py-2 text-right">Our cost / day</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => {
                const net = netCost(row.listDailyRate, row.discountPercent)
                return (
                  <tr
                    key={row.id}
                    onClick={() => router.push(`/sub-rentals/vehicles/${row.id}`)}
                    className={`hover:bg-gray-50 cursor-pointer ${row.isActive ? '' : 'opacity-50'}`}
                  >
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {row.name}
                      {!row.isActive && (
                        <span className="ml-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500">
                          retired
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{row.vehicleType ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-700">{row.vendor.name}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700">{fmtMoney(row.listDailyRate)}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700">{fmtMoney(row.listWeeklyRate)}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700">
                      {row.discountPercent == null ? '—' : `${Number(row.discountPercent)}%`}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-700 font-semibold">
                      {net == null ? '—' : fmtMoney(net)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {showAdd && (
        <AddVehicleModal
          onClose={() => setShowAdd(false)}
          onCreated={(id) => router.push(`/sub-rentals/vehicles/${id}`)}
        />
      )}
    </div>
  )
}
