'use client'

/**
 * The client rate card, on the CRM client file.
 *
 * This is the answer to "their rate on super cargo vans is $130, where
 * our primary rate is $170 — how do we make sure they see that in the
 * line?" (Wes, 2026-08-29). A rate set here becomes what the LINE bills
 * at on every future quote for this client, so the PDF prints
 * "$130.00/day" — not $170 with a discount row underneath.
 *
 * It is deliberately NOT the discount profile above it. That block is
 * institutional memory ("they usually angle for 15%") and nothing reads
 * it into pricing; this one is wired into rate resolution.
 *
 * Writes are ADMIN-only server-side; non-admins see the card read-only
 * rather than a hidden panel, so a sales rep can still tell the client's
 * price without being able to change it.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  LineItemDescriptionCombobox,
  type CatalogHit,
} from '@/components/orders/LineItemDescriptionCombobox'

export interface NegotiatedRate {
  id: string
  inventoryItemId: string
  code: string
  name: string
  department: string
  itemActive: boolean
  dailyRate: number | null
  weeklyRate: number | null
  listDailyRate: number
  listWeeklyRate: number
  note: string | null
  setBy: string | null
  updatedAt: string
}

const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

const DEPT_LABEL: Record<string, string> = {
  VEHICLES: 'Vehicles',
  COMMUNICATIONS: 'Communications',
  STAGES: 'Studios',
  PRO_SUPPLIES: 'Pro Supplies',
  EXPENDABLES: 'Expendables',
  GE: 'Grip & Electric',
  ART: 'Art Department',
}

export function NegotiatedRatesPanel({
  companyId,
  companyName,
  canEdit,
}: {
  companyId: string
  companyName: string
  canEdit: boolean
}) {
  const [rates, setRates] = useState<NegotiatedRate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Add-row state
  const [pickDesc, setPickDesc] = useState('')
  const [pickItem, setPickItem] = useState<{ id: string; name: string; listDaily: number } | null>(null)
  const [daily, setDaily] = useState('')
  const [weekly, setWeekly] = useState('')
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/crm/companies/${companyId}/rates`)
    if (!res.ok) {
      // 403 = this role can't see pricing at all; render nothing rather
      // than an error the user can do nothing about.
      setRates([])
      return
    }
    const data = await res.json()
    setRates(data.rates ?? [])
  }, [companyId])

  useEffect(() => { void load() }, [load])

  const resetAdd = () => {
    setPickDesc(''); setPickItem(null); setDaily(''); setWeekly(''); setNote('')
  }

  const save = async (inventoryItemId: string, d: string, w: string, n: string) => {
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/crm/companies/${companyId}/rates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventoryItemId, dailyRate: d || null, weeklyRate: w || null, note: n || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.reason || data.error || 'Could not save that rate.'); return false }
      await load()
      return true
    } finally {
      setSaving(false)
    }
  }

  const remove = async (rateId: string, name: string) => {
    if (!confirm(`Remove the negotiated rate on ${name}? ${companyName} goes back to list price on it. Existing quotes keep the price they were sent at.`)) return
    setSaving(true)
    try {
      const res = await fetch(`/api/crm/companies/${companyId}/rates/${rateId}`, { method: 'DELETE' })
      if (!res.ok) { setError('Could not remove that rate.'); return }
      await load()
    } finally {
      setSaving(false)
    }
  }

  if (rates === null) return null
  // Nothing negotiated and no ability to add one — no empty furniture.
  if (rates.length === 0 && !canEdit) return null

  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl p-4 mt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-lt-fg">Negotiated rates</h3>
        <span className="text-[11px] text-lt-fg3">
          Replaces the per-day price on their quotes — not a discount line
        </span>
      </div>

      {rates.length === 0 ? (
        <p className="text-xs text-lt-fg3 mt-2">
          No negotiated rates. {companyName} is quoted list price on everything.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-lt-fg3 text-left">
                <th className="pb-2 font-semibold">Item</th>
                <th className="pb-2 font-semibold text-right">Their daily</th>
                <th className="pb-2 font-semibold text-right">List</th>
                <th className="pb-2 font-semibold text-right">Their weekly</th>
                <th className="pb-2 font-semibold">Note</th>
                {canEdit && <th className="pb-2" />}
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.id} className="border-t border-lt-hairline">
                  <td className="py-2 pr-3">
                    <div className="text-lt-fg">{r.name}</div>
                    <div className="text-[11px] text-lt-fg3">
                      {DEPT_LABEL[r.department] ?? r.department}
                      {!r.itemActive && ' · item archived'}
                    </div>
                  </td>
                  <td className="py-2 text-right font-mono text-amber-500">
                    {r.dailyRate == null ? '--' : usd(r.dailyRate)}
                  </td>
                  {/* Shown so a deal that has drifted past list after a
                      price change is visible instead of silent. */}
                  <td className="py-2 text-right font-mono text-lt-fg3 line-through">
                    {usd(r.listDailyRate)}
                  </td>
                  <td className="py-2 text-right font-mono text-lt-fg2">
                    {r.weeklyRate == null ? '--' : usd(r.weeklyRate)}
                  </td>
                  <td className="py-2 pl-3 text-xs text-lt-fg2">{r.note || '--'}</td>
                  {canEdit && (
                    <td className="py-2 pl-3 text-right">
                      <button
                        onClick={() => void remove(r.id, r.name)}
                        disabled={saving}
                        className="text-xs text-lt-fg3 hover:text-red-500 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <div className="mt-4 pt-4 border-t border-lt-hairline">
          <div className="text-[11px] uppercase tracking-wider text-lt-fg3 font-bold mb-2">
            Add a negotiated rate
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_110px_110px] gap-2">
            <LineItemDescriptionCombobox
              value={pickDesc}
              onChange={(next) => { setPickDesc(next); if (!next) setPickItem(null) }}
              onPickCatalog={(hit: CatalogHit) => {
                // Packages price off their own row and have no catalog
                // item to hang a negotiated rate on — see the API.
                if (hit.type !== 'INVENTORY') return
                setPickDesc(hit.name)
                setPickItem({ id: hit.id, name: hit.name, listDaily: hit.listDailyRate ?? hit.dailyRate })
              }}
              onClearCatalog={() => setPickItem(null)}
              catalogBinding={pickItem ? { id: pickItem.id, type: 'INVENTORY', name: pickItem.name } : null}
              types={['INVENTORY']}
              placeholder="Search the catalog…"
              hideCustomChip
            />
            <input
              value={daily}
              onChange={(e) => setDaily(e.target.value)}
              placeholder="Daily $"
              inputMode="decimal"
              className="px-2 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg"
            />
            <input
              value={weekly}
              onChange={(e) => setWeekly(e.target.value)}
              placeholder="Weekly $"
              inputMode="decimal"
              className="px-2 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg"
            />
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why (internal) — e.g. 2026 season deal"
            className="mt-2 w-full px-2 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg"
          />
          <div className="flex items-center gap-3 mt-2">
            <button
              disabled={!pickItem || saving || (!daily && !weekly)}
              onClick={async () => {
                if (!pickItem) return
                if (await save(pickItem.id, daily, weekly, note)) resetAdd()
              }}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:hover:bg-amber-600 text-white text-sm rounded-lg"
            >
              {saving ? 'Saving…' : 'Set rate'}
            </button>
            {pickItem && (
              <span className="text-xs text-lt-fg3">
                List is {usd(pickItem.listDaily)}/day
              </span>
            )}
            {error && <span className="text-xs text-red-500">{error}</span>}
          </div>
          <p className="text-[11px] text-lt-fg3 mt-2">
            Leave a field blank to keep the catalog price for that billing
            type. Setting a rate here does not change quotes already sent.
          </p>
        </div>
      )}
    </div>
  )
}
