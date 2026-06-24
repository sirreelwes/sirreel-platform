'use client'

/**
 * InventoryItemDrawer — the single edit surface for an inventory item.
 * Replaces the old inline row editor + InventoryDetailModal. A
 * right-side drawer holding every editable field, the photo control
 * (reuses the shared 1600px client resize + HEIC passthrough + 10MB
 * cap), the preferred-vendor picker (+ inline new vendor), the
 * item-specific reorder URL, a live "Total value" (qty × replacement),
 * and Save / Cancel / Delete (archive-or-permanent, guarded).
 *
 * All mutations go through the session-gated item API:
 *   - Save      → PUT  /api/inventory/items/[id]
 *   - Archive   → PUT  /api/inventory/items/[id]  { isActive:false }
 *   - Restore   → PUT  /api/inventory/items/[id]  { isActive:true }
 *   - Delete    → DELETE /api/inventory/items/[id]  (zero-ref only)
 *   - Photo     → POST/DELETE /api/inventory/items/[id]/image
 *
 * Price contract: InventoryItem is the live catalog; existing
 * OrderLineItems snapshot their own rate and are NOT touched. A MANUAL
 * RateChangeLog row is written server-side when a rate changes.
 */

import { useEffect, useRef, useState } from 'react'
import { uploadInventoryItemImage, ACCEPT_IMAGE, MAX_IMAGE_BYTES } from '@/lib/inventory/resizeImage'

export interface DrawerItem {
  id: string
  code: string
  description: string | null
  aliases?: string[] | null
  dailyRate: string
  weeklyRate: string
  qtyOwned: number
  replacementCost: string | null
  imageUrl: string | null
  preferredVendorId: string | null
  preferredVendor: { id: string; name: string; website: string | null } | null
  vendorItemUrl: string | null
  locationRef: { id: string; name: string; code: string } | null
  category: { id: string; name: string } | null
  isActive?: boolean
  archivedAt?: string | null
}

interface CategoryOption { id: string; name: string }
interface LocationOption { id: string; name: string; code: string }
interface VendorOption { id: string; name: string; website: string | null }

const fmtUsd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

export function InventoryItemDrawer({
  open, item, categories, locations, onClose, onSaved, onArchived, onDeleted,
}: {
  open: boolean
  item: DrawerItem | null
  categories: CategoryOption[]
  locations: LocationOption[]
  onClose: () => void
  onSaved: () => void
  onArchived: () => void
  onDeleted: () => void
}) {
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [qtyOwned, setQtyOwned] = useState('0')
  const [dailyRate, setDailyRate] = useState('0')
  const [weeklyRate, setWeeklyRate] = useState('0')
  const [replacementCost, setReplacementCost] = useState('')
  const [locationId, setLocationId] = useState('')
  const [preferredVendorId, setPreferredVendorId] = useState('')
  const [vendorItemUrl, setVendorItemUrl] = useState('')
  // Client-facing search aliases — comma-separated in the editor, stored
  // as a normalized String[] on the item. Internal-only surface.
  const [aliasesInput, setAliasesInput] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  const [vendors, setVendors] = useState<VendorOption[]>([])
  const [addingVendor, setAddingVendor] = useState(false)
  const [newVendorName, setNewVendorName] = useState('')
  const [newVendorWebsite, setNewVendorWebsite] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Delete flow: confirmText must equal DELETE to enable; refs holds the
  // server's reference count once checked.
  const [confirmText, setConfirmText] = useState('')
  const [refs, setRefs] = useState<{ total: number; orderLineItems: number; packageItems: number; subRentals: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const archived = !!item && item.isActive === false

  // Hydrate from the item each open.
  useEffect(() => {
    if (!item) return
    setDescription(item.description ?? item.code)
    setCategoryId(item.category?.id ?? '')
    setQtyOwned(String(item.qtyOwned))
    setDailyRate(String(Number(item.dailyRate)))
    setWeeklyRate(String(Number(item.weeklyRate)))
    setReplacementCost(item.replacementCost ? String(Number(item.replacementCost)) : '')
    setLocationId(item.locationRef?.id ?? '')
    setPreferredVendorId(item.preferredVendorId ?? '')
    setVendorItemUrl(item.vendorItemUrl ?? '')
    setAliasesInput((item.aliases ?? []).join(', '))
    setImageUrl(item.imageUrl)
    setError('')
    setConfirmText('')
    setRefs(null)
    setAddingVendor(false)
    setNewVendorName('')
    setNewVendorWebsite('')
  }, [item])

  // Vendor list — refetch each open so vendors added elsewhere show.
  useEffect(() => {
    if (!open) return
    fetch('/api/vendors')
      .then((r) => r.json())
      .then((d) => setVendors(Array.isArray(d?.vendors) ? d.vendors.map((v: VendorOption) => ({ id: v.id, name: v.name, website: v.website ?? null })) : []))
      .catch(() => {})
  }, [open])

  if (!open || !item) return null

  const totalValue = (Number(replacementCost) || 0) * (Number(qtyOwned) || 0)
  const selectedVendor = vendors.find((v) => v.id === preferredVendorId) || null
  const effectiveReorderUrl = vendorItemUrl.trim() || selectedVendor?.website || ''

  const putItem = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/inventory/items/${item.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.error || `HTTP ${res.status}`)
    }
    return res.json()
  }

  const save = async () => {
    setBusy(true); setError('')
    try {
      await putItem({
        description: description.trim() || item.code,
        categoryId: categoryId || null,
        qtyOwned,
        dailyRate,
        weeklyRate,
        replacementCost: replacementCost === '' ? null : replacementCost,
        locationId: locationId || null,
        preferredVendorId: preferredVendorId || null,
        vendorItemUrl: vendorItemUrl.trim() || null,
        aliases: aliasesInput.split(',').map((s) => s.trim()).filter(Boolean),
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const onPickPhoto = async (file: File) => {
    setBusy(true); setError('')
    try {
      const newUrl = await uploadInventoryItemImage(item.id, file)
      setImageUrl(newUrl)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const removePhoto = async () => {
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/inventory/items/${item.id}/image`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `HTTP ${res.status}`)
      }
      setImageUrl(null)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed')
    } finally {
      setBusy(false)
    }
  }

  const createVendorInline = async () => {
    if (!newVendorName.trim()) { setError('Vendor name is required.'); return }
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newVendorName.trim(), website: newVendorWebsite.trim() || null }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`)
      const v = d.vendor
      setVendors((prev) => [...prev, { id: v.id, name: v.name, website: v.website ?? null }])
      setPreferredVendorId(v.id)
      setAddingVendor(false); setNewVendorName(''); setNewVendorWebsite('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create vendor failed')
    } finally {
      setBusy(false)
    }
  }

  const archive = async () => {
    setBusy(true); setError('')
    try {
      await putItem({ isActive: false })
      onArchived(); onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Archive failed')
    } finally { setBusy(false) }
  }

  const restore = async () => {
    setBusy(true); setError('')
    try {
      await putItem({ isActive: true })
      onArchived(); onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed')
    } finally { setBusy(false) }
  }

  // First step of delete: type DELETE then click — fetch references to
  // decide archive-only vs offer permanent delete.
  const checkRefsThenAct = async () => {
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/inventory/items/${item.id}/references`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`)
      setRefs(d.references)
      if (d.references.total > 0) {
        // Referenced — archive only.
        await putItem({ isActive: false })
        onArchived(); onClose()
      }
      // total === 0 → fall through; UI now shows the permanent-delete choice.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete check failed')
    } finally { setBusy(false) }
  }

  const permanentlyDelete = async () => {
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/inventory/items/${item.id}`, { method: 'DELETE' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 409 && d.references) {
          // Race: became referenced since the check → archive instead.
          setRefs(d.references)
          await putItem({ isActive: false })
          onArchived(); onClose()
          return
        }
        throw new Error(d.error || `HTTP ${res.status}`)
      }
      onDeleted(); onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally { setBusy(false) }
  }

  const field = 'w-full bg-lt-card border border-lt-hairline rounded-lg px-3 py-2 text-sm text-lt-fg focus:outline-none focus:border-amber-500'
  const label = 'block text-[11px] font-semibold text-lt-fg2 uppercase tracking-wider mb-1'

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button aria-label="Close" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-[480px] h-full bg-lt-card border-l border-lt-hairline shadow-2xl overflow-y-auto">
        <div className="sticky top-0 z-10 bg-lt-card border-b border-lt-hairline px-5 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-mono text-lt-fg3">{item.code}</div>
            <h2 className="text-lg font-bold text-lt-fg truncate">{description || item.code}</h2>
            {archived && <span className="text-[11px] font-bold text-chip-bad-fg">Archived{item.archivedAt ? ` · ${new Date(item.archivedAt).toLocaleDateString()}` : ''}</span>}
          </div>
          <button onClick={onClose} className="text-lt-fg3 hover:text-lt-fg text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="text-sm text-chip-bad-fg bg-chip-bad-bg border border-chip-bad-fg/20 rounded-lg px-3 py-2">{error}</div>}

          {/* Photo */}
          <div className="flex items-start gap-3">
            <div className="flex-none w-24 h-24 rounded-lg bg-lt-inner border border-lt-hairline overflow-hidden flex items-center justify-center text-lt-fg3 text-xs">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/inventory/items/${item.id}/image?v=${encodeURIComponent(imageUrl)}`} alt="" className="w-full h-full object-cover" />
              ) : <span>No photo</span>}
            </div>
            <div className="flex-1 space-y-2">
              <label className="block">
                <span className="sr-only">Choose photo</span>
                <input ref={fileRef} type="file" accept={ACCEPT_IMAGE} disabled={busy}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickPhoto(f) }}
                  className="block w-full text-xs text-lt-fg2 file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-amber-600 hover:file:bg-amber-500 file:text-white file:cursor-pointer file:text-xs file:font-semibold" />
              </label>
              {imageUrl && (
                <button type="button" onClick={removePhoto} disabled={busy} className="text-xs text-chip-bad-fg hover:opacity-80 disabled:opacity-50">Remove photo</button>
              )}
              <p className="text-[10px] text-lt-fg3 leading-tight">jpg / png / webp (resized to 1600px) or heic. Max {MAX_IMAGE_BYTES / 1024 / 1024} MB.</p>
            </div>
          </div>

          <div>
            <label className={label}>Name</label>
            <input className={field} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={item.code} />
          </div>

          <div>
            <label className={label}>Client search aliases</label>
            <input
              className={field}
              value={aliasesInput}
              onChange={(e) => setAliasesInput(e.target.value)}
              placeholder="walkies, walkie, handheld"
            />
            <p className="mt-1 text-[11px] text-gray-400">
              Comma-separated informal terms clients search by. Matched on the order form; never shown as the item name.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Category</label>
              <select className={field} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Uncategorized</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Location</label>
              <select className={field} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">—</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={label}>Qty owned</label>
              <input className={field + ' tabular-nums'} type="number" min={0} step={1} value={qtyOwned} onChange={(e) => setQtyOwned(e.target.value)} />
            </div>
            <div>
              <label className={label}>Daily rate</label>
              <input className={field + ' tabular-nums'} type="number" min={0} step="0.01" value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} />
            </div>
            <div>
              <label className={label}>Weekly rate</label>
              <input className={field + ' tabular-nums'} type="number" min={0} step="0.01" value={weeklyRate} onChange={(e) => setWeeklyRate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <label className={label}>Replacement cost</label>
              <input className={field + ' tabular-nums'} type="number" min={0} step="0.01" value={replacementCost} onChange={(e) => setReplacementCost(e.target.value)} placeholder="—" />
            </div>
            <div>
              <label className={label}>Total value (qty × replacement)</label>
              <div className="px-3 py-2 rounded-lg bg-lt-inner border border-lt-hairline text-base font-bold tabular-nums text-chip-good-fg">{totalValue > 0 ? fmtUsd(totalValue) : '—'}</div>
            </div>
          </div>

          {/* Vendor */}
          <div className="space-y-2 border-t border-lt-hairline pt-4">
            <label className={label}>Preferred replacement vendor</label>
            {!addingVendor ? (
              <div className="flex gap-2">
                <select className={field} value={preferredVendorId} onChange={(e) => setPreferredVendorId(e.target.value)}>
                  <option value="">— none —</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
                <button type="button" onClick={() => setAddingVendor(true)} className="whitespace-nowrap px-3 py-2 text-xs font-semibold text-lt-fg2 border border-lt-hairline rounded-lg hover:bg-lt-inner">+ New</button>
              </div>
            ) : (
              <div className="space-y-2 bg-lt-inner border border-lt-hairline rounded-lg p-3">
                <input className={field} value={newVendorName} onChange={(e) => setNewVendorName(e.target.value)} placeholder="Vendor name *" />
                <input className={field} value={newVendorWebsite} onChange={(e) => setNewVendorWebsite(e.target.value)} placeholder="Website (optional)" />
                <div className="flex gap-2">
                  <button type="button" onClick={createVendorInline} disabled={busy} className="px-3 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-500 rounded-lg disabled:opacity-50">Create</button>
                  <button type="button" onClick={() => setAddingVendor(false)} className="px-3 py-1.5 text-xs text-lt-fg2 hover:text-lt-fg">Cancel</button>
                </div>
              </div>
            )}
            <div>
              <label className={label}>Item reorder URL (overrides vendor site)</label>
              <input className={field} value={vendorItemUrl} onChange={(e) => setVendorItemUrl(e.target.value)} placeholder="https://…" />
              {effectiveReorderUrl && (
                <a href={effectiveReorderUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-amber-700 hover:underline mt-1 inline-block">reorder link ↗</a>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="border-t border-lt-hairline pt-4 flex items-center gap-2">
            {!archived ? (
              <>
                <button onClick={save} disabled={busy} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">{busy ? 'Saving…' : 'Save'}</button>
                <button onClick={onClose} disabled={busy} className="px-4 py-2 text-sm text-lt-fg2 hover:text-lt-fg">Cancel</button>
              </>
            ) : (
              <button onClick={restore} disabled={busy} className="px-4 py-2 bg-chip-good-fg hover:opacity-90 disabled:opacity-50 text-white text-sm font-bold rounded-lg">Restore item</button>
            )}
          </div>

          {/* Delete / archive zone */}
          {!archived && (
            <div className="border-t border-lt-hairline pt-4 space-y-2">
              <label className={label}>Delete — type DELETE to enable</label>
              <div className="flex gap-2">
                <input className={field} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" />
                <button
                  onClick={checkRefsThenAct}
                  disabled={busy || confirmText !== 'DELETE'}
                  className="whitespace-nowrap px-3 py-2 text-xs font-bold text-white bg-chip-bad-fg hover:opacity-90 disabled:opacity-40 rounded-lg"
                >
                  Delete…
                </button>
              </div>
              {refs && refs.total === 0 && (
                <div className="bg-chip-warn-bg border border-chip-warn-fg/20 rounded-lg p-3 space-y-2">
                  <p className="text-xs text-chip-warn-fg">No references found. Archive (reversible) or permanently delete?</p>
                  <div className="flex gap-2">
                    <button onClick={archive} disabled={busy} className="px-3 py-1.5 text-xs font-semibold text-lt-fg border border-lt-hairline bg-lt-card rounded-lg hover:bg-lt-inner">Archive</button>
                    <button onClick={permanentlyDelete} disabled={busy} className="px-3 py-1.5 text-xs font-bold text-white bg-chip-bad-fg hover:opacity-90 rounded-lg">Permanently delete</button>
                  </div>
                </div>
              )}
              {refs && refs.total > 0 && (
                <p className="text-xs text-chip-warn-fg">Referenced by {refs.total} record(s) — archived, not deleted.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
