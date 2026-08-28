'use client'

/**
 * /sub-rentals/vehicles/[id] — one subcontracted vehicle's page.
 *
 * The rate card is the centerpiece: per term (daily / weekly /
 * monthly) the vendor's list rate, our discount, and the derived net
 * cost — derived HERE, never stored, so a renegotiated discount
 * repaints every number at once. Edit mode covers every roster field;
 * Retire soft-deactivates (isActive=false) and Reactivate undoes it.
 *
 * Same gate as the roster: the API 403s anyone without
 * subRentals + seePricing (fleet-side roles).
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { fmtMoney, netCost } from '@/lib/sub-rentals/vehicles'
import VehicleFeesCard from '@/components/sub-rentals/VehicleFeesCard'
import VehiclePhotosCard from '@/components/sub-rentals/VehiclePhotosCard'

interface Vehicle {
  id: string
  name: string
  vehicleType: string | null
  description: string | null
  specs: string | null
  listDailyRate: string | null
  listWeeklyRate: string | null
  listMonthlyRate: string | null
  rateNotes: string | null
  discountPercent: string | null
  isActive: boolean
  updatedAt: string
  vendor: {
    id: string
    name: string
    contactName: string | null
    email: string | null
    phone: string | null
    website: string | null
    address: string | null
    notes: string | null
  }
}

interface Draft {
  name: string
  vehicleType: string
  description: string
  specs: string
  listDailyRate: string
  listWeeklyRate: string
  listMonthlyRate: string
  rateNotes: string
  discountPercent: string
}

function toDraft(v: Vehicle): Draft {
  return {
    name: v.name,
    vehicleType: v.vehicleType ?? '',
    description: v.description ?? '',
    specs: v.specs ?? '',
    listDailyRate: v.listDailyRate ?? '',
    listWeeklyRate: v.listWeeklyRate ?? '',
    listMonthlyRate: v.listMonthlyRate ?? '',
    rateNotes: v.rateNotes ?? '',
    discountPercent: v.discountPercent ?? '',
  }
}

const TERMS = [
  { key: 'listDailyRate', label: 'Daily' },
  { key: 'listWeeklyRate', label: 'Weekly' },
  { key: 'listMonthlyRate', label: 'Monthly' },
] as const

export default function SubcontractedVehiclePage() {
  const params = useParams<{ id: string }>()
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/sub-rentals/vehicles/${params.id}`, { cache: 'no-store' })
      if (r.status === 403) {
        setError('Sales / billing / admin access required — this page carries vendor pricing.')
        return
      }
      if (r.status === 404) {
        setError('Vehicle not found.')
        return
      }
      const j = await r.json()
      setVehicle(j.vehicle)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed')
    } finally {
      setLoading(false)
    }
  }, [params.id])

  useEffect(() => { load() }, [load])

  const patch = async (body: Record<string, unknown>) => {
    setSaving(true)
    setError(null)
    try {
      const r = await fetch(`/api/sub-rentals/vehicles/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? `save failed (${r.status})`)
      setVehicle(j.vehicle)
      setEditing(false)
      setDraft(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed')
    } finally {
      setSaving(false)
    }
  }

  const saveDraft = () => {
    if (!draft) return
    patch({
      name: draft.name,
      vehicleType: draft.vehicleType,
      description: draft.description,
      specs: draft.specs,
      listDailyRate: draft.listDailyRate.trim() || null,
      listWeeklyRate: draft.listWeeklyRate.trim() || null,
      listMonthlyRate: draft.listMonthlyRate.trim() || null,
      rateNotes: draft.rateNotes,
      discountPercent: draft.discountPercent.trim() || null,
    })
  }

  if (loading) {
    return <div className="p-8 text-sm text-gray-500 text-center">Loading…</div>
  }
  if (!vehicle) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
          {error ?? 'Vehicle not found.'}
        </div>
      </div>
    )
  }

  const d = draft
  const field = 'w-full border border-gray-300 rounded px-2 py-1.5 text-sm'
  const label = 'block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1'

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="text-xs text-gray-400 mb-0.5">
        <Link href="/sub-rentals" className="hover:underline">Sub-rentals</Link>
        {' / '}
        <Link href="/sub-rentals/vehicles" className="hover:underline">Vehicles</Link>
      </div>

      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            {vehicle.name}
            {!vehicle.isActive && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500">
                retired
              </span>
            )}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {vehicle.vehicleType ?? 'Subcontracted vehicle'} · owned by{' '}
            <span className="font-medium text-gray-700">{vehicle.vendor.name}</span>
            {' '}· subcontracted — not SirReel fleet
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {editing ? (
            <>
              <button
                onClick={() => { setEditing(false); setDraft(null); setError(null) }}
                className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveDraft}
                disabled={saving}
                className="px-3 py-1.5 text-sm rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => patch({ isActive: !vehicle.isActive })}
                disabled={saving}
                className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {vehicle.isActive ? 'Retire' : 'Reactivate'}
              </button>
              <button
                onClick={() => { setDraft(toDraft(vehicle)); setEditing(true) }}
                className="px-3 py-1.5 text-sm rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold"
              >
                Edit
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 mb-4">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* ── Rate card ── */}
        <div className="md:col-span-2 bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex items-baseline justify-between">
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Rate structure</h2>
            {editing && d ? (
              <div className="flex items-center gap-1.5 text-sm">
                <span className="text-gray-500">Our discount</span>
                <input
                  value={d.discountPercent}
                  onChange={(e) => setDraft({ ...d, discountPercent: e.target.value })}
                  inputMode="decimal"
                  className="w-16 border border-gray-300 rounded px-2 py-0.5 text-sm text-right"
                />
                <span className="text-gray-500">%</span>
              </div>
            ) : (
              <div className="text-sm text-gray-500">
                Our discount:{' '}
                <span className="font-mono font-semibold text-gray-900">
                  {vehicle.discountPercent == null ? 'not set' : `${Number(vehicle.discountPercent)}%`}
                </span>
              </div>
            )}
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
                <th className="px-4 py-2">Term</th>
                <th className="px-4 py-2 text-right">{vehicle.vendor.name} list</th>
                <th className="px-4 py-2 text-right">Our net cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {TERMS.map(({ key, label: term }) => {
                const listVal = editing && d ? d[key] : vehicle[key]
                const net = editing
                  ? netCost(listVal || null, (d?.discountPercent ?? '').trim() || null)
                  : netCost(vehicle[key], vehicle.discountPercent)
                return (
                  <tr key={key}>
                    <td className="px-4 py-2.5 font-medium text-gray-900">{term}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-700">
                      {editing && d ? (
                        <input
                          value={d[key]}
                          onChange={(e) => setDraft({ ...d, [key]: e.target.value })}
                          inputMode="decimal"
                          placeholder="—"
                          className="w-28 border border-gray-300 rounded px-2 py-0.5 text-sm text-right font-mono"
                        />
                      ) : (
                        fmtMoney(vehicle[key])
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-emerald-700 font-semibold">
                      {net == null ? '—' : fmtMoney(net)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-gray-100">
            <div className={label}>Rate structure notes</div>
            {editing && d ? (
              <textarea
                value={d.rateNotes}
                onChange={(e) => setDraft({ ...d, rateNotes: e.target.value })}
                rows={3}
                placeholder="3-day week, delivery fees, fuel, damage waiver, minimums…"
                className={field}
              />
            ) : (
              <p className="text-sm text-gray-700 whitespace-pre-wrap">
                {vehicle.rateNotes ?? <span className="text-gray-400">None yet.</span>}
              </p>
            )}
          </div>
        </div>

        {/* ── Owner card ── */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-3">Owner</h2>
          <div className="text-sm text-gray-900 font-medium">{vehicle.vendor.name}</div>
          <dl className="mt-2 space-y-1.5 text-sm">
            {vehicle.vendor.contactName && (
              <div><dt className="inline text-gray-500">Contact: </dt><dd className="inline text-gray-800">{vehicle.vendor.contactName}</dd></div>
            )}
            {vehicle.vendor.phone && (
              <div><dt className="inline text-gray-500">Phone: </dt><dd className="inline text-gray-800">{vehicle.vendor.phone}</dd></div>
            )}
            {vehicle.vendor.email && (
              <div><dt className="inline text-gray-500">Email: </dt><dd className="inline text-gray-800">{vehicle.vendor.email}</dd></div>
            )}
            {vehicle.vendor.website && (
              <div><dt className="inline text-gray-500">Web: </dt><dd className="inline text-gray-800">{vehicle.vendor.website}</dd></div>
            )}
            {vehicle.vendor.address && (
              <div className="whitespace-pre-wrap text-gray-800 pt-1 border-t border-gray-100 mt-2">{vehicle.vendor.address}</div>
            )}
          </dl>
          <div className="mt-3 pt-2 border-t border-gray-100 text-xs text-gray-400">
            Vendor record is shared with sub-rental sourcing — edit it on the vendors admin.
          </div>
        </div>
      </div>

      {/* Fees sit directly under the rate card: together they are the
          whole cost of a day, and quoting off the rate alone is the
          mistake this page exists to prevent. */}
      <div className="mt-4">
        <VehicleFeesCard
          vehicleId={vehicle.id}
          vendorId={vehicle.vendor.id}
          vendorName={vehicle.vendor.name}
          discountPercent={vehicle.discountPercent}
        />
      </div>

      <div className="mt-4">
        <VehiclePhotosCard vehicleId={vehicle.id} />
      </div>

      {/* ── Identity / specs ── */}
      <div className="mt-4 bg-white border border-gray-200 rounded-xl p-4 space-y-4">
        {editing && d ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Vehicle name</label>
                <input value={d.name} onChange={(e) => setDraft({ ...d, name: e.target.value })} className={field} />
              </div>
              <div>
                <label className={label}>Type</label>
                <input value={d.vehicleType} onChange={(e) => setDraft({ ...d, vehicleType: e.target.value })} placeholder="e.g. Star Trailer" className={field} />
              </div>
            </div>
            <div>
              <label className={label}>Description</label>
              <textarea value={d.description} onChange={(e) => setDraft({ ...d, description: e.target.value })} rows={2} className={field} />
            </div>
            <div>
              <label className={label}>Specs (one per line)</label>
              <textarea value={d.specs} onChange={(e) => setDraft({ ...d, specs: e.target.value })} rows={4} className={field} />
            </div>
          </>
        ) : (
          <>
            <div>
              <div className={label}>Description</div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">
                {vehicle.description ?? <span className="text-gray-400">None yet.</span>}
              </p>
            </div>
            <div>
              <div className={label}>Specs</div>
              {vehicle.specs ? (
                <ul className="text-sm text-gray-700 list-disc list-inside space-y-0.5">
                  {vehicle.specs.split('\n').filter((s) => s.trim()).map((s, i) => <li key={i}>{s.trim()}</li>)}
                </ul>
              ) : (
                <p className="text-sm text-gray-400">None yet.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
