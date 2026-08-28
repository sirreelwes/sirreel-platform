'use client'

/**
 * Ancillary-fee schedule on a subcontracted vehicle's page.
 *
 * Shows the fees that land on top of the day/week rate — driver,
 * mileage, generator, supplies — because a quote built from the base
 * rate alone is short by most of a real day's cost.
 *
 * Two scopes render in one table: rows inherited from the vendor's
 * standing schedule (vehicleId null — "all <vendor> vehicles") and
 * rows specific to this unit. The GET already unions them; the Scope
 * column is what keeps the distinction legible, since editing an
 * inherited row changes it for every unit that vendor owns.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  SUB_FEE_UNITS,
  UNION_SCOPE_LABEL,
  formatFeeRate,
  coversHoursNote,
  feeNetAmount,
  fmtMoney,
  type SubFeeUnit,
  type SubFeeUnionScope,
} from '@/lib/sub-rentals/vehicles'

interface Fee {
  id: string
  vehicleId: string | null
  label: string
  amount: string
  unit: SubFeeUnit
  coversHours: string | null
  unionScope: SubFeeUnionScope
  discountApplies: boolean
  notes: string | null
  isActive: boolean
}

interface Props {
  vehicleId: string
  vendorId: string
  vendorName: string
  discountPercent: string | null
}

interface FormState {
  label: string
  amount: string
  unit: SubFeeUnit
  coversHours: string
  unionScope: SubFeeUnionScope
  discountApplies: boolean
  scopeAllVehicles: boolean
  notes: string
}

const EMPTY_FORM: FormState = {
  label: '',
  amount: '',
  unit: 'PER_DAY',
  coversHours: '',
  unionScope: 'ALL',
  discountApplies: false,
  scopeAllVehicles: true,
  notes: '',
}

const field = 'w-full border border-gray-300 rounded px-2 py-1.5 text-sm'
const labelCls = 'block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1'

export default function VehicleFeesCard({ vehicleId, vendorId, vendorName, discountPercent }: Props) {
  const [fees, setFees] = useState<Fee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/sub-rentals/fees?vehicleId=${vehicleId}`, { cache: 'no-store' })
      if (r.status === 403) { setError('Pricing access required.'); return }
      const j = await r.json()
      setFees(j.fees ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed')
    } finally {
      setLoading(false)
    }
  }, [vehicleId])

  useEffect(() => { load() }, [load])

  const toPayload = (f: FormState) => ({
    label: f.label.trim(),
    amount: f.amount.trim(),
    unit: f.unit,
    coversHours: f.coversHours.trim() || null,
    unionScope: f.unionScope,
    discountApplies: f.discountApplies,
    notes: f.notes.trim() || null,
  })

  const create = async () => {
    if (!form.label.trim() || !form.amount.trim()) {
      setError('Label and amount are both required.')
      return
    }
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/sub-rentals/fees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...toPayload(form),
          // Vendor-wide rows carry vendorId and NO vehicleId; unit-specific
          // rows send vehicleId and let the server derive the vendor.
          ...(form.scopeAllVehicles ? { vendorId } : { vehicleId }),
          sortOrder: fees.length,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? `create failed (${r.status})`)
      setForm(EMPTY_FORM); setAdding(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'create failed')
    } finally {
      setBusy(false)
    }
  }

  const saveEdit = async (id: string) => {
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/sub-rentals/fees/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toPayload(editForm)),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? `save failed (${r.status})`)
      setEditingId(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/sub-rentals/fees/${id}`, { method: 'DELETE' })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error ?? `delete failed (${r.status})`)
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'delete failed')
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (f: Fee) => {
    setEditingId(f.id)
    setEditForm({
      label: f.label,
      amount: f.amount ?? '',
      unit: f.unit,
      coversHours: f.coversHours ?? '',
      unionScope: f.unionScope,
      discountApplies: f.discountApplies,
      scopeAllVehicles: f.vehicleId == null,
      notes: f.notes ?? '',
    })
  }

  // Wes gave non-union driver rates and said union follows later. Surface
  // that as a stated gap so a union job doesn't get quoted off the
  // non-union number by someone who never knew the difference existed.
  const hasNonUnion = fees.some((f) => f.unionScope === 'NON_UNION')
  const hasUnion = fees.some((f) => f.unionScope === 'UNION')

  const renderForm = (f: FormState, set: (s: FormState) => void, onSave: () => void, onCancel: () => void) => (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="col-span-2 md:col-span-1">
          <label className={labelCls}>Fee</label>
          <input value={f.label} onChange={(e) => set({ ...f, label: e.target.value })} placeholder="Driver" className={field} />
        </div>
        <div>
          <label className={labelCls}>Amount</label>
          <input value={f.amount} onChange={(e) => set({ ...f, amount: e.target.value })} inputMode="decimal" placeholder="550" className={field} />
        </div>
        <div>
          <label className={labelCls}>Per</label>
          <select value={f.unit} onChange={(e) => set({ ...f, unit: e.target.value as SubFeeUnit })} className={field}>
            {SUB_FEE_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Covers hrs</label>
          <input value={f.coversHours} onChange={(e) => set({ ...f, coversHours: e.target.value })} inputMode="decimal" placeholder="10" className={field} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div>
          <label className={labelCls}>Applies to</label>
          <select value={f.unionScope} onChange={(e) => set({ ...f, unionScope: e.target.value as SubFeeUnionScope })} className={field}>
            <option value="ALL">All jobs</option>
            <option value="NON_UNION">Non-union only</option>
            <option value="UNION">Union only</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Scope</label>
          <select
            value={f.scopeAllVehicles ? 'vendor' : 'vehicle'}
            onChange={(e) => set({ ...f, scopeAllVehicles: e.target.value === 'vendor' })}
            className={field}
          >
            <option value="vendor">All {vendorName} vehicles</option>
            <option value="vehicle">This vehicle only</option>
          </select>
        </div>
        <div className="flex items-end pb-1.5">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={f.discountApplies}
              onChange={(e) => set({ ...f, discountApplies: e.target.checked })}
              className="rounded border-gray-300"
            />
            Our discount applies
          </label>
        </div>
      </div>

      <div>
        <label className={labelCls}>Notes</label>
        <input value={f.notes} onChange={(e) => set({ ...f, notes: e.target.value })} placeholder="OT beyond 10 hrs, minimums…" className={field} />
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
        <button onClick={onSave} disabled={busy} className="px-3 py-1.5 text-sm rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold disabled:opacity-50">
          {busy ? 'Saving…' : 'Save fee'}
        </button>
      </div>
    </div>
  )

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Fees on top of the rate</h2>
          <p className="text-xs text-gray-500 mt-0.5">Driver, mileage, generator, supplies — what a real day actually costs.</p>
        </div>
        {!adding && (
          <button onClick={() => { setForm(EMPTY_FORM); setAdding(true) }} className="px-2.5 py-1 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50 shrink-0">
            + Fee
          </button>
        )}
      </div>

      {error && (
        <div className="mx-4 mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</div>
      )}

      {loading ? (
        <div className="p-6 text-sm text-gray-500 text-center">Loading fees…</div>
      ) : (
        <>
          {fees.length === 0 && !adding ? (
            <div className="p-6 text-sm text-gray-500 text-center">
              No fees recorded yet. Add the driver, mileage, generator and supplies rates so quotes are whole.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
                  <th className="px-4 py-2">Fee</th>
                  <th className="px-4 py-2 text-right">Their rate</th>
                  <th className="px-4 py-2">Applies to</th>
                  <th className="px-4 py-2">Scope</th>
                  <th className="px-4 py-2 text-right">Our cost</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {fees.map((f) => {
                  const note = coversHoursNote(f)
                  const net = feeNetAmount(f, discountPercent)
                  if (editingId === f.id) {
                    return (
                      <tr key={f.id}>
                        <td colSpan={6} className="px-4 py-3">
                          {renderForm(editForm, setEditForm, () => saveEdit(f.id), () => setEditingId(null))}
                        </td>
                      </tr>
                    )
                  }
                  return (
                    <tr key={f.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-gray-900">{f.label}</div>
                        {f.notes && <div className="text-xs text-gray-500">{f.notes}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="font-mono text-gray-900">{formatFeeRate(f)}</div>
                        {note && <div className="text-xs text-gray-500">{note}</div>}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                          f.unionScope === 'UNION' ? 'bg-indigo-100 text-indigo-800'
                          : f.unionScope === 'NON_UNION' ? 'bg-blue-100 text-blue-800'
                          : 'bg-zinc-100 text-zinc-600'}`}>
                          {UNION_SCOPE_LABEL[f.unionScope]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-600">
                        {f.vehicleId ? 'This vehicle' : `All ${vendorName}`}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono">
                        {net == null
                          ? <span className="text-gray-400">pass-through</span>
                          : <span className="text-emerald-700 font-semibold">{fmtMoney(net)}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <button onClick={() => startEdit(f)} className="text-xs text-blue-700 hover:underline">Edit</button>
                        <button onClick={() => remove(f.id)} disabled={busy} className="ml-3 text-xs text-rose-600 hover:underline disabled:opacity-50">Delete</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {adding && (
            <div className="p-4 border-t border-gray-100">
              {renderForm(form, setForm, create, () => setAdding(false))}
            </div>
          )}

          {hasNonUnion && !hasUnion && (
            <div className="px-4 py-2.5 border-t border-gray-100 bg-amber-50 text-xs text-amber-900">
              Union labor rates aren’t recorded yet — the driver rate above is non-union only. Quote a union job off it and you’ll be under.
            </div>
          )}
        </>
      )}
    </div>
  )
}
