'use client'

/**
 * Package builder admin page.
 *
 * Left rail: list of packages with active toggle + select-to-edit.
 * Right pane: form for the selected (or new) package — name, dept,
 * description, price/day, items (inventory picker reusing the
 * LineItemDescriptionCombobox in INVENTORY-only mode with a qty
 * stepper). Running "Component value: $X/day" + implied discount %
 * sits beside the price field.
 *
 * Auth gating happens at the API layer; the page renders for any
 * session user (staff perm).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LineItemDescriptionCombobox } from '@/components/orders/LineItemDescriptionCombobox'
import { CurrencyInput } from '@/components/ui/CurrencyInput'

type Department =
  | 'COMMUNICATIONS' | 'PRO_SUPPLIES' | 'ART' | 'VEHICLES' | 'GE' | 'STAGES' | 'EXPENDABLES'

const DEPARTMENTS: Department[] = [
  'COMMUNICATIONS', 'PRO_SUPPLIES', 'ART', 'VEHICLES', 'GE', 'STAGES', 'EXPENDABLES',
]

interface PackageRow {
  id: string
  name: string
  description: string | null
  department: Department
  pricePerDay: number
  active: boolean
  itemCount: number
  componentValue: number
  discountPct: number
  items: {
    id: string
    inventoryItemId: string
    qty: number
    inventoryItem: { id: string; code: string; description: string | null; dailyRate: number }
  }[]
}

interface DraftItem {
  inventoryItemId: string
  qty: number
  // Display fields cached from the picker — survive replace-all save
  // by being re-derived on package-fetch.
  name: string
  code: string
  dailyRate: number
}

const fmtUsd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

export default function AdminPackagesPage() {
  const router = useRouter()
  const [packages, setPackages] = useState<PackageRow[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Edit-form state. Hydrated when selectedId changes.
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [department, setDepartment] = useState<Department>('GE')
  const [price, setPrice] = useState('')
  const [active, setActive] = useState(true)
  const [draftItems, setDraftItems] = useState<DraftItem[]>([])
  const [pickerValue, setPickerValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const res = await fetch('/api/admin/packages')
      const data = await res.json()
      if (!res.ok) { setErr(data?.error || `HTTP ${res.status}`); return }
      setPackages(data.packages as PackageRow[])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed')
    }
  }, [])

  useEffect(() => { load() }, [load])

  const hydrateForm = useCallback((pkg: PackageRow | null) => {
    if (!pkg) {
      setName(''); setDescription(''); setDepartment('GE')
      setPrice(''); setActive(true); setDraftItems([])
      return
    }
    setName(pkg.name)
    setDescription(pkg.description ?? '')
    setDepartment(pkg.department)
    setPrice(String(pkg.pricePerDay))
    setActive(pkg.active)
    setDraftItems(pkg.items.map((it) => ({
      inventoryItemId: it.inventoryItemId,
      qty: it.qty,
      name: it.inventoryItem.description || it.inventoryItem.code,
      code: it.inventoryItem.code,
      dailyRate: it.inventoryItem.dailyRate,
    })))
  }, [])

  // Sync the form when selection changes.
  useEffect(() => {
    if (selectedId == null) return
    if (selectedId === 'new') { hydrateForm(null); return }
    const pkg = packages?.find((p) => p.id === selectedId)
    if (pkg) hydrateForm(pkg)
  }, [selectedId, packages, hydrateForm])

  const componentValue = useMemo(
    () => draftItems.reduce((s, it) => s + it.dailyRate * it.qty, 0),
    [draftItems],
  )
  const priceNum = Number(price) || 0
  const discountPct = componentValue > 0
    ? Math.round(((componentValue - priceNum) / componentValue) * 100)
    : 0

  const addItem = (hit: { id: string; name: string; dailyRate: number }) => {
    // Use the inventory item's code from the catalog hit — for
    // INVENTORY hits the API's `name` is description || code, so we
    // store both for the display.
    setDraftItems((prev) => {
      const idx = prev.findIndex((it) => it.inventoryItemId === hit.id)
      if (idx >= 0) {
        // Already in the list — bump qty.
        return prev.map((it, i) => i === idx ? { ...it, qty: it.qty + 1 } : it)
      }
      return [
        ...prev,
        {
          inventoryItemId: hit.id,
          qty: 1,
          name: hit.name,
          code: hit.name, // we don't have separate code in the hit; fine
          dailyRate: hit.dailyRate,
        },
      ]
    })
    setPickerValue('')
  }

  const removeItem = (inventoryItemId: string) => {
    setDraftItems((prev) => prev.filter((it) => it.inventoryItemId !== inventoryItemId))
  }

  const setQty = (inventoryItemId: string, qty: number) => {
    setDraftItems((prev) => prev.map((it) =>
      it.inventoryItemId === inventoryItemId ? { ...it, qty: Math.max(1, qty) } : it,
    ))
  }

  const save = async () => {
    if (!name.trim()) { setErr('Name required'); return }
    if (priceNum < 0) { setErr('Price must be ≥ 0'); return }
    setSaving(true)
    setErr(null)
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        department,
        pricePerDay: priceNum,
        active,
        items: draftItems.map((it) => ({ inventoryItemId: it.inventoryItemId, qty: it.qty })),
      }
      const isNew = selectedId === 'new'
      const res = await fetch(isNew ? '/api/admin/packages' : `/api/admin/packages/${selectedId}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data?.error || `HTTP ${res.status}`); return }
      await load()
      setSelectedId(isNew ? data.id : selectedId)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!selectedId || selectedId === 'new') return
    if (!confirm(`Delete package "${name}"? Orders that referenced it stay intact (FK becomes null).`)) return
    setDeleting(true)
    setErr(null)
    try {
      const res = await fetch(`/api/admin/packages/${selectedId}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d?.error || `HTTP ${res.status}`); return }
      await load()
      setSelectedId(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'delete failed')
    } finally {
      setDeleting(false)
    }
  }

  const toggleActive = async (pkg: PackageRow) => {
    try {
      const res = await fetch(`/api/admin/packages/${pkg.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !pkg.active }),
      })
      if (!res.ok) return
      await load()
    } catch { /* swallow */ }
  }

  return (
    <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-7xl mx-auto">
        <button onClick={() => router.push('/dashboard')} className="text-sm text-lt-fg3 hover:text-lt-fg mb-4 inline-block">
          &larr; Back to dashboard
        </button>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold text-lt-fg">Packages</h1>
          <button
            onClick={() => setSelectedId('new')}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-lg"
          >
            + New package
          </button>
        </div>

        {err && (
          <div className="text-sm text-chip-bad-fg bg-chip-bad-bg/30 px-3 py-2 rounded mb-4">{err}</div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* List */}
          <div className="lg:col-span-1">
            <div className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-lt-hairline text-[10px] uppercase tracking-wider text-lt-fg3 font-semibold">
                {packages?.length ?? 0} package{(packages?.length ?? 0) === 1 ? '' : 's'}
              </div>
              {packages == null ? (
                <div className="px-4 py-8 text-sm text-lt-fg3 text-center">Loading…</div>
              ) : packages.length === 0 ? (
                <div className="px-4 py-8 text-sm text-lt-fg3 text-center">No packages yet. Tap <span className="text-amber-600">+ New package</span> to build the first one.</div>
              ) : (
                <div className="divide-y divide-lt-hairline">
                  {packages.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedId(p.id)}
                      className={`w-full text-left px-4 py-3 hover:bg-lt-inner/40 ${selectedId === p.id ? 'bg-amber-50' : ''} ${!p.active ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <div className="text-sm font-semibold text-lt-fg truncate">{p.name}</div>
                        <span className="text-[10px] font-mono text-lt-fg2 shrink-0">{fmtUsd(p.pricePerDay)}/d</span>
                      </div>
                      <div className="text-[11px] text-lt-fg3 flex items-center justify-between">
                        <span>{p.department.replace(/_/g, ' ')} · {p.itemCount} item{p.itemCount === 1 ? '' : 's'}</span>
                        <span className="flex items-center gap-2">
                          {p.discountPct > 0 && <span className="text-emerald-700 font-medium">{p.discountPct}% off</span>}
                          <span
                            onClick={(e) => { e.stopPropagation(); toggleActive(p) }}
                            className={`text-[10px] px-1.5 py-0.5 rounded cursor-pointer ${p.active ? 'bg-emerald-50 text-emerald-700' : 'bg-lt-inner text-lt-fg3'}`}
                          >
                            {p.active ? 'active' : 'inactive'}
                          </span>
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Edit form */}
          <div className="lg:col-span-2">
            {selectedId == null ? (
              <div className="bg-lt-card border border-lt-hairline rounded-xl px-6 py-12 text-center text-sm text-lt-fg3">
                Select a package on the left or tap <span className="text-amber-600">+ New package</span> to start.
              </div>
            ) : (
              <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-lt-fg">
                    {selectedId === 'new' ? 'New package' : `Edit: ${name || '(unnamed)'}`}
                  </h2>
                  <label className="flex items-center gap-2 text-xs text-lt-fg2">
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={(e) => setActive(e.target.checked)}
                    />
                    Active (visible in the line-item combobox)
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <label className="block">
                    <span className="text-xs text-lt-fg3 mb-1 block">Name</span>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Grip Starter Pack"
                      className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-lt-fg3 mb-1 block">Department</span>
                    <select
                      value={department}
                      onChange={(e) => setDepartment(e.target.value as Department)}
                      className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg"
                    >
                      {DEPARTMENTS.map((d) => (
                        <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="block">
                  <span className="text-xs text-lt-fg3 mb-1 block">Description (optional)</span>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    placeholder="What this package is for. Surfaces in the picker dropdown."
                    className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg resize-none"
                  />
                </label>

                <div className="grid grid-cols-2 gap-4">
                  <label className="block">
                    <span className="text-xs text-lt-fg3 mb-1 block">Price per day</span>
                    <CurrencyInput
                      value={Number(price) || 0}
                      onChange={(next) => setPrice(next === 0 ? '' : String(next))}
                      min={0}
                      placeholder="0.00"
                      inputClassName="px-3 py-2 bg-lt-inner border border-lt-hairline rounded text-sm text-lt-fg font-mono"
                      ariaLabel="Package price per day"
                    />
                  </label>
                  <div className="bg-lt-inner border border-lt-hairline rounded p-3 flex flex-col justify-center">
                    <div className="text-[10px] uppercase tracking-wider text-lt-fg3 font-semibold mb-1">Component value</div>
                    <div className="text-sm font-mono text-lt-fg">{fmtUsd(componentValue)}/d</div>
                    {componentValue > 0 && (
                      <div className={`text-[11px] mt-1 ${discountPct > 0 ? 'text-emerald-700' : discountPct < 0 ? 'text-chip-warn-fg' : 'text-lt-fg2'}`}>
                        {discountPct > 0 ? `Package saves ${discountPct}% vs à la carte` : discountPct < 0 ? `Package is ${Math.abs(discountPct)}% MORE than à la carte` : 'Even with à la carte'}
                      </div>
                    )}
                  </div>
                </div>

                {/* Item picker + list */}
                <div className="space-y-2">
                  <div className="text-xs text-lt-fg3 font-semibold uppercase tracking-wider">Items</div>
                  <LineItemDescriptionCombobox
                    value={pickerValue}
                    onChange={(next) => setPickerValue(next)}
                    onPickCatalog={(hit) => addItem(hit)}
                    catalogBinding={null}
                    types={['INVENTORY']}
                    placeholder="Type to search inventory — pick to add to package…"
                    hideCustomChip
                  />
                  {draftItems.length === 0 ? (
                    <div className="text-xs text-lt-fg3 text-center py-4">No items yet.</div>
                  ) : (
                    <div className="border border-lt-hairline rounded divide-y divide-lt-hairline">
                      {draftItems.map((it) => (
                        <div key={it.inventoryItemId} className="px-3 py-2 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-lt-fg truncate">{it.name}</div>
                            <div className="text-[11px] text-lt-fg3 font-mono">{fmtUsd(it.dailyRate)}/d standard rate</div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setQty(it.inventoryItemId, it.qty - 1)}
                              className="w-6 h-6 rounded bg-lt-inner hover:bg-lt-hairline text-lt-fg text-xs"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min="1"
                              value={it.qty}
                              onChange={(e) => setQty(it.inventoryItemId, Number(e.target.value) || 1)}
                              className="w-12 bg-lt-inner border border-lt-hairline rounded text-center text-sm text-lt-fg font-mono"
                            />
                            <button
                              type="button"
                              onClick={() => setQty(it.inventoryItemId, it.qty + 1)}
                              className="w-6 h-6 rounded bg-lt-inner hover:bg-lt-hairline text-lt-fg text-xs"
                            >
                              +
                            </button>
                          </div>
                          <div className="text-xs font-mono text-lt-fg2 w-20 text-right">{fmtUsd(it.dailyRate * it.qty)}/d</div>
                          <button
                            type="button"
                            onClick={() => removeItem(it.inventoryItemId)}
                            className="text-[10px] text-chip-bad-fg hover:opacity-70 px-1.5"
                            title="Remove item"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-lt-hairline">
                  <div>
                    {selectedId !== 'new' && (
                      <button
                        type="button"
                        onClick={remove}
                        disabled={deleting}
                        className="text-xs text-chip-bad-fg hover:opacity-70 disabled:opacity-50"
                      >
                        {deleting ? 'Deleting…' : 'Delete package'}
                      </button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedId(null)}
                      className="px-4 py-2 text-sm text-lt-fg2 hover:text-lt-fg"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={save}
                      disabled={saving || !name.trim()}
                      className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg"
                    >
                      {saving ? 'Saving…' : selectedId === 'new' ? 'Create package' : 'Save changes'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
