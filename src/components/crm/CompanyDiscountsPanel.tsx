'use client'

/**
 * Standing discounts for one client — entered here, read by the client on
 * their account portal, and applied to every order from here on.
 *
 * Wes 2026-09-04: "At the top should be their company discounts if entered
 * by SirReel … These discounts should be auto applied in all orders from
 * that company going forward."
 *
 * The panel states the consequence on the form rather than in a tooltip,
 * because the consequence is the whole point and it is not reversible on
 * work already done: adding a row here changes what the next quote says.
 * A rep who thinks they are writing a note needs to find out before they
 * save, not after a client sees 50% off on a quote.
 *
 * DEPARTMENT vs ITEMS is a real fork, so the form makes you choose one and
 * explains what each does — a department discount prints as a discount row
 * under the section, an item discount prints as a reduced rate on the line.
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Trash2, X } from 'lucide-react'

const DEPARTMENTS: { value: string; label: string }[] = [
  { value: 'VEHICLES', label: 'Vehicles' },
  { value: 'COMMUNICATIONS', label: 'Communications' },
  { value: 'STAGES', label: 'Stages' },
  { value: 'PRO_SUPPLIES', label: 'Production supplies' },
  { value: 'EXPENDABLES', label: 'Expendables' },
  { value: 'GE', label: 'Grip & electric' },
  { value: 'ART', label: 'Art department' },
  { value: 'WARDROBE_MAKEUP', label: 'Wardrobe & makeup' },
]

interface Discount {
  id: string
  label: string
  percentOff: number
  departmentKey: string | null
  inventoryItemIds: string[]
  itemNames: string[]
  conditions: string | null
  internalNote: string | null
  effectiveDate: string | null
  expiryDate: string | null
  isActive: boolean
}

interface ItemHit {
  id: string
  name: string
}

function fmt(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function CompanyDiscountsPanel({
  companyId,
  canEdit,
}: {
  companyId: string
  canEdit: boolean
}) {
  const [rows, setRows] = useState<Discount[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // New-row form state
  const [label, setLabel] = useState('')
  const [percentOff, setPercentOff] = useState('')
  const [scope, setScope] = useState<'DEPARTMENT' | 'ITEMS'>('DEPARTMENT')
  const [departmentKey, setDepartmentKey] = useState('PRO_SUPPLIES')
  const [itemQuery, setItemQuery] = useState('')
  const [itemHits, setItemHits] = useState<ItemHit[]>([])
  const [pickedItems, setPickedItems] = useState<ItemHit[]>([])
  const [conditions, setConditions] = useState('')
  const [internalNote, setInternalNote] = useState('')
  const [expiryDate, setExpiryDate] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/crm/companies/${companyId}/discounts`)
    const json = await res.json().catch(() => ({}))
    setRows(json.discounts || [])
  }, [companyId])

  useEffect(() => {
    load()
  }, [load])

  // Item typeahead — only relevant in ITEMS scope.
  useEffect(() => {
    if (scope !== 'ITEMS' || itemQuery.trim().length < 2) {
      setItemHits([])
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        // /api/inventory/search is the token-matching catalog lookup the
        // order line-item form already uses. Items carry `code` +
        // `description`, not a `name` column.
        const res = await fetch(
          `/api/inventory/search?q=${encodeURIComponent(itemQuery.trim())}&limit=8`,
        )
        const json = await res.json().catch(() => ({}))
        const hits: ItemHit[] = (json.items || [])
          .slice(0, 8)
          .map((i: { id: string; code: string; description: string | null }) => ({
            id: i.id,
            name: i.description || i.code,
          }))
          .filter((i: ItemHit) => i.id && i.name)
        if (!cancelled) setItemHits(hits)
      } catch {
        if (!cancelled) setItemHits([])
      }
    }, 220)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [itemQuery, scope])

  function resetForm() {
    setLabel('')
    setPercentOff('')
    setScope('DEPARTMENT')
    setDepartmentKey('PRO_SUPPLIES')
    setItemQuery('')
    setItemHits([])
    setPickedItems([])
    setConditions('')
    setInternalNote('')
    setExpiryDate('')
    setError(null)
  }

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/companies/${companyId}/discounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label,
          percentOff: Number(percentOff),
          departmentKey: scope === 'DEPARTMENT' ? departmentKey : null,
          inventoryItemIds: scope === 'ITEMS' ? pickedItems.map((i) => i.id) : [],
          conditions: conditions || null,
          internalNote: internalNote || null,
          expiryDate: expiryDate || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Could not save')
      resetForm()
      setAdding(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  // Wes 2026-09-04: "change the terms for each dept" — the number is the
  // term. Edit it in place; the label and scope stay (a different scope is
  // a different deal — add a row).
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPct, setEditPct] = useState('')
  async function savePercent(id: string) {
    const pct = Math.round(Number(editPct))
    if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
      setError('Percent off must be between 1 and 100.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/companies/${companyId}/discounts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ percentOff: pct }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Could not save')
      setEditingId(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  async function deactivate(id: string) {
    setBusy(true)
    await fetch(`/api/crm/companies/${companyId}/discounts/${id}`, { method: 'DELETE' })
    await load()
    setBusy(false)
  }

  const active = (rows || []).filter((r) => r.isActive)
  const inactive = (rows || []).filter((r) => !r.isActive)

  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <h2 className="text-base font-semibold text-lt-fg">Standing discounts</h2>
          <p className="text-xs text-lt-fg2 mt-0.5 max-w-[62ch] leading-relaxed">
            Shown at the top of this client&apos;s account portal, and{' '}
            <strong className="text-lt-fg">applied automatically to every new order</strong> for
            this company. Orders already created keep the discount they were built with.
          </p>
        </div>
        {canEdit && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-lt-fg hover:text-black"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        )}
      </div>

      {rows === null ? (
        <div className="flex items-center gap-2 text-sm text-lt-fg3 mt-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {active.length === 0 && !adding && (
            <p className="text-sm text-lt-fg3 mt-3">
              No standing discounts. This client is quoted at list unless a rep discounts the order
              by hand.
            </p>
          )}

          {active.length > 0 && (
            <div className="mt-3 space-y-2">
              {active.map((d) => (
                <div
                  key={d.id}
                  className="flex items-start gap-3 border border-lt-hairline rounded-lg p-3"
                >
                  {canEdit && editingId === d.id ? (
                    <div className="shrink-0 flex items-center gap-1">
                      <input
                        autoFocus
                        type="number"
                        min={1}
                        max={100}
                        value={editPct}
                        onChange={(e) => setEditPct(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') savePercent(d.id)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        className="w-16 text-sm border border-lt-hairline rounded-md px-2 py-1 bg-lt-card text-lt-fg tabular-nums"
                      />
                      <span className="text-sm text-lt-fg3">%</span>
                      <button
                        onClick={() => savePercent(d.id)}
                        disabled={busy}
                        className="text-xs font-semibold text-lt-fg hover:text-black ml-1"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (!canEdit) return
                        setEditingId(d.id)
                        setEditPct(String(d.percentOff))
                      }}
                      title={canEdit ? 'Change the percent' : undefined}
                      className={`shrink-0 rounded-md bg-lt-inner px-2 py-1 text-sm font-bold tabular-nums text-lt-fg ${canEdit ? 'hover:bg-lt-hairline cursor-pointer' : 'cursor-default'}`}
                    >
                      {d.percentOff}%
                    </button>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-lt-fg">off {d.label}</div>
                    <div className="text-xs text-lt-fg2 mt-0.5">
                      {d.departmentKey ? (
                        <>
                          <span className="font-medium">
                            {DEPARTMENTS.find((x) => x.value === d.departmentKey)?.label ||
                              d.departmentKey}
                          </span>{' '}
                          department · prints as a discount row
                        </>
                      ) : (
                        <>
                          <span className="font-medium">{d.itemNames.join(', ')}</span> · prints as a
                          reduced rate
                        </>
                      )}
                    </div>
                    {d.conditions && (
                      <div className="text-xs text-lt-fg2 mt-1">Client sees: {d.conditions}</div>
                    )}
                    {d.internalNote && (
                      <div className="text-xs text-lt-fg3 mt-1 italic">
                        Internal: {d.internalNote}
                      </div>
                    )}
                    {d.expiryDate && (
                      <div className="text-xs text-lt-fg3 mt-1">Ends {fmt(d.expiryDate)}</div>
                    )}
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => deactivate(d.id)}
                      disabled={busy}
                      title="Turn off — the record is kept"
                      className="shrink-0 text-lt-fg3 hover:text-chip-bad-fg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {inactive.length > 0 && (
            <details className="mt-3">
              <summary className="text-xs text-lt-fg3 cursor-pointer hover:text-lt-fg">
                Ended ({inactive.length})
              </summary>
              <div className="mt-2 space-y-1">
                {inactive.map((d) => (
                  <div key={d.id} className="text-xs text-lt-fg3">
                    {d.percentOff}% off {d.label}
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}

      {adding && (
        <div className="mt-4 border-t border-lt-hairline pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider text-lt-fg3">
              New standing discount
            </div>
            <button
              onClick={() => {
                resetForm()
                setAdding(false)
              }}
              className="text-lt-fg3 hover:text-lt-fg"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-[80px_1fr] gap-2">
            <div>
              <label className="block text-[11px] text-lt-fg3 mb-1">% off</label>
              <input
                type="number"
                min={1}
                max={100}
                value={percentOff}
                onChange={(e) => setPercentOff(e.target.value)}
                placeholder="50"
                className="w-full text-sm border border-lt-hairline rounded-lg px-2.5 py-2 bg-lt-card text-lt-fg"
              />
            </div>
            <div>
              <label className="block text-[11px] text-lt-fg3 mb-1">
                What it covers — the client reads this
              </label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Production supply orders"
                className="w-full text-sm border border-lt-hairline rounded-lg px-2.5 py-2 bg-lt-card text-lt-fg"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-lt-fg3 mb-1.5">How it applies</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setScope('DEPARTMENT')}
                className={`text-left rounded-lg border px-3 py-2 ${
                  scope === 'DEPARTMENT' ? 'border-lt-fg' : 'border-lt-hairline'
                }`}
              >
                <div className="text-sm font-medium text-lt-fg">A whole department</div>
                <div className="text-[11px] text-lt-fg2 mt-0.5">
                  Discount row under the section subtotal
                </div>
              </button>
              <button
                type="button"
                onClick={() => setScope('ITEMS')}
                className={`text-left rounded-lg border px-3 py-2 ${
                  scope === 'ITEMS' ? 'border-lt-fg' : 'border-lt-hairline'
                }`}
              >
                <div className="text-sm font-medium text-lt-fg">Specific items</div>
                <div className="text-[11px] text-lt-fg2 mt-0.5">Reduced rate on those lines</div>
              </button>
            </div>
          </div>

          {scope === 'DEPARTMENT' ? (
            <div>
              <label className="block text-[11px] text-lt-fg3 mb-1">Department</label>
              <select
                value={departmentKey}
                onChange={(e) => setDepartmentKey(e.target.value)}
                className="w-full text-sm border border-lt-hairline rounded-lg px-2.5 py-2 bg-lt-card text-lt-fg"
              >
                {DEPARTMENTS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-[11px] text-lt-fg3 mb-1">
                Items — e.g. cube trucks and cargo vans
              </label>
              {pickedItems.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {pickedItems.map((i) => (
                    <span
                      key={i.id}
                      className="inline-flex items-center gap-1 text-xs bg-lt-inner text-lt-fg px-2 py-1 rounded"
                    >
                      {i.name}
                      <button
                        onClick={() =>
                          setPickedItems((prev) => prev.filter((p) => p.id !== i.id))
                        }
                        className="text-lt-fg3 hover:text-lt-fg"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <input
                value={itemQuery}
                onChange={(e) => setItemQuery(e.target.value)}
                placeholder="Type to search the catalog…"
                className="w-full text-sm border border-lt-hairline rounded-lg px-2.5 py-2 bg-lt-card text-lt-fg"
              />
              {itemHits.length > 0 && (
                <div className="mt-1 border border-lt-hairline rounded-lg divide-y divide-lt-hairline max-h-40 overflow-y-auto">
                  {itemHits
                    .filter((h) => !pickedItems.some((p) => p.id === h.id))
                    .map((h) => (
                      <button
                        key={h.id}
                        onClick={() => {
                          setPickedItems((prev) => [...prev, h])
                          setItemQuery('')
                          setItemHits([])
                        }}
                        className="block w-full text-left text-sm px-3 py-2 text-lt-fg hover:bg-lt-inner"
                      >
                        {h.name}
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-lt-fg3 mb-1">
                Conditions the client should see (optional)
              </label>
              <input
                value={conditions}
                onChange={(e) => setConditions(e.target.value)}
                placeholder="Orders over $2,500"
                className="w-full text-sm border border-lt-hairline rounded-lg px-2.5 py-2 bg-lt-card text-lt-fg"
              />
            </div>
            <div>
              <label className="block text-[11px] text-lt-fg3 mb-1">Ends (optional)</label>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="w-full text-sm border border-lt-hairline rounded-lg px-2.5 py-2 bg-lt-card text-lt-fg"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-lt-fg3 mb-1">
              Internal note — never shown to the client (optional)
            </label>
            <input
              value={internalNote}
              onChange={(e) => setInternalNote(e.target.value)}
              placeholder="2026 season deal, agreed with Dana"
              className="w-full text-sm border border-lt-hairline rounded-lg px-2.5 py-2 bg-lt-card text-lt-fg"
            />
          </div>

          {error && <p className="text-xs text-chip-bad-fg">{error}</p>}

          <div className="flex items-center gap-2">
            <button
              onClick={create}
              disabled={busy || !label.trim() || !percentOff}
              className="inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-40"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Save discount
            </button>
            <span className="text-xs text-lt-fg3">Applies to orders created from now on.</span>
          </div>
        </div>
      )}
    </div>
  )
}
