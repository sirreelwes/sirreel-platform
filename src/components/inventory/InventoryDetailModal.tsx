'use client'

/**
 * InventoryDetailModal — image + preferred-vendor controls for a single
 * inventory item. Opens from the row "Details" button on /inventory.
 * Style mirrors AddItemModal (zinc-900 panel, amber-500 focus, white
 * text on dark).
 *
 * Image flow:
 *   - Replace: file input → client-side canvas resize (≤1600px long
 *     edge, JPEG 0.85) for jpg/png/webp; HEIC/HEIF uploads pass through
 *     raw (canvas can't decode HEIC in Chrome/Firefox). POSTs multipart
 *     to /api/inventory/items/[id]/image.
 *   - Remove: DELETEs the same endpoint, clears imageUrl on the row.
 *
 * Vendor flow (RELATIONAL):
 *   - Preferred vendor is picked from active rows in the shared
 *     `Vendor` table (same table sub-rentals use). Inline "+ New
 *     vendor" affordance creates a Vendor via POST /api/vendors and
 *     auto-selects it without leaving the modal.
 *   - `vendorItemUrl` is an OPTIONAL per-item product/reorder link.
 *     When present it's the effective reorder URL for THIS item;
 *     otherwise the row falls back to the vendor's default website.
 *   - Save PATCHes the item via PUT /api/inventory/items/[id] with
 *     `preferredVendorId` + `vendorItemUrl`.
 */

import { useEffect, useState } from 'react'
import {
  resizeImage,
  RESIZEABLE_MIME,
  ACCEPT_IMAGE as ACCEPT,
  MAX_IMAGE_BYTES as MAX_BYTES,
  MAX_LONG_EDGE,
} from '@/lib/inventory/resizeImage'

export interface InventoryDetailItem {
  id: string
  code: string
  description: string | null
  imageUrl: string | null
  preferredVendorId: string | null
  preferredVendor: { id: string; name: string; website: string | null; isActive: boolean } | null
  vendorItemUrl: string | null
}

interface VendorOption {
  id: string
  name: string
  website: string | null
}

interface InventoryDetailModalProps {
  open: boolean
  item: InventoryDetailItem | null
  onClose: () => void
  onSaved: () => void
}

export function InventoryDetailModal({ open, item, onClose, onSaved }: InventoryDetailModalProps) {
  const [vendors, setVendors] = useState<VendorOption[]>([])
  const [preferredVendorId, setPreferredVendorId] = useState<string>('')
  const [vendorItemUrl, setVendorItemUrl] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Inline "+ New vendor" form state
  const [addingVendor, setAddingVendor] = useState(false)
  const [newVendorName, setNewVendorName] = useState('')
  const [newVendorWebsite, setNewVendorWebsite] = useState('')

  // Re-seed on open / item change.
  useEffect(() => {
    if (!open || !item) return
    setPreferredVendorId(item.preferredVendorId ?? '')
    setVendorItemUrl(item.vendorItemUrl ?? '')
    setImageUrl(item.imageUrl)
    setError('')
    setAddingVendor(false)
    setNewVendorName('')
    setNewVendorWebsite('')
  }, [open, item])

  // Vendor list — refetch each open so newly-added vendors elsewhere
  // appear without a hard refresh.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch('/api/vendors')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        const rows = Array.isArray(d?.vendors) ? d.vendors : []
        setVendors(rows.map((v: VendorOption) => ({ id: v.id, name: v.name, website: v.website ?? null })))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [open])

  if (!open || !item) return null

  const selectedVendor = vendors.find((v) => v.id === preferredVendorId) || null
  const effectiveUrl = vendorItemUrl.trim() || selectedVendor?.website || ''

  const replaceImage = async (file: File) => {
    setError('')
    if (file.size > MAX_BYTES) {
      setError(`Image is ${(file.size / 1024 / 1024).toFixed(1)} MB; cap is ${MAX_BYTES / 1024 / 1024} MB.`)
      return
    }
    setBusy(true)
    try {
      const uploadable: Blob = RESIZEABLE_MIME.has(file.type) ? await resizeImage(file) : file
      const form = new FormData()
      const filename = RESIZEABLE_MIME.has(file.type) ? 'resized.jpg' : file.name
      const type = RESIZEABLE_MIME.has(file.type) ? 'image/jpeg' : file.type
      form.append('file', new File([uploadable], filename, { type }))
      const res = await fetch(`/api/inventory/items/${item.id}/image`, {
        method: 'POST',
        body: form,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Upload failed (HTTP ${res.status}).`)
        return
      }
      setImageUrl(data.item.imageUrl)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  const removeImage = async () => {
    if (!confirm('Remove image from this item?')) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/inventory/items/${item.id}/image`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Remove failed (HTTP ${res.status}).`)
        return
      }
      setImageUrl(null)
      onSaved()
    } finally {
      setBusy(false)
    }
  }

  const createVendorInline = async () => {
    if (!newVendorName.trim()) {
      setError('Vendor name is required.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newVendorName.trim(),
          website: newVendorWebsite.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // POST returns the existing vendor id on 409 dupe-name — adopt it
        // so the rep doesn't have to scroll the picker to find the
        // already-existing row.
        if (res.status === 409 && data?.vendorId) {
          setPreferredVendorId(data.vendorId)
          setAddingVendor(false)
          setNewVendorName('')
          setNewVendorWebsite('')
          // Refresh picker
          const refreshed = await fetch('/api/vendors').then((r) => r.json()).catch(() => ({ vendors: [] }))
          setVendors(refreshed.vendors || [])
          setError('That vendor already existed — selected it instead.')
          return
        }
        setError(data.error || `Create vendor failed (HTTP ${res.status}).`)
        return
      }
      // POST returns the vendor row directly (no wrapper).
      const newId: string = data.id
      setVendors((prev) => [...prev, { id: data.id, name: data.name, website: data.website ?? null }]
        .sort((a, b) => a.name.localeCompare(b.name)))
      setPreferredVendorId(newId)
      setAddingVendor(false)
      setNewVendorName('')
      setNewVendorWebsite('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed.')
    } finally {
      setBusy(false)
    }
  }

  const saveVendor = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/inventory/items/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferredVendorId: preferredVendorId || null,
          vendorItemUrl: vendorItemUrl,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Save failed (HTTP ${res.status}).`)
        return
      }
      onSaved()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={() => !busy && onClose()}
    >
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 max-w-xl w-full space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
              {item.code}
            </div>
            <h2 className="text-base font-bold text-white mt-0.5 break-words">
              {item.description || item.code}
            </h2>
          </div>
          <button
            onClick={() => !busy && onClose()}
            className="text-zinc-500 hover:text-zinc-300 text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Image section */}
        <section className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">
            Photo
          </div>
          <div className="flex items-start gap-4">
            <div className="w-40 h-40 bg-zinc-800 border border-zinc-700 rounded-lg overflow-hidden flex items-center justify-center text-zinc-600 text-xs">
              {imageUrl ? (
                // Private blob — served via the gated proxy (raw URL 403s).
                // Buster keyed on imageUrl so a freshly-replaced photo refetches.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/inventory/items/${item.id}/image?v=${encodeURIComponent(imageUrl)}`} alt={item.description || item.code} className="w-full h-full object-cover" />
              ) : (
                <span>No image</span>
              )}
            </div>
            <div className="flex-1 space-y-2">
              <label className="block">
                <span className="sr-only">Choose image</span>
                <input
                  type="file"
                  accept={ACCEPT}
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void replaceImage(f)
                    e.target.value = ''
                  }}
                  className="block w-full text-xs text-zinc-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-amber-600 hover:file:bg-amber-500 file:text-white file:cursor-pointer file:text-xs file:font-semibold"
                />
              </label>
              {imageUrl && (
                <button
                  type="button"
                  onClick={removeImage}
                  disabled={busy}
                  className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                >
                  Remove image
                </button>
              )}
              <p className="text-[10px] text-zinc-500 leading-tight">
                jpg / png / webp (resized client-side to {MAX_LONG_EDGE}px long edge) or heic (passthrough).
                Max {MAX_BYTES / 1024 / 1024} MB.
              </p>
            </div>
          </div>
        </section>

        {/* Vendor section */}
        <section className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">
            Preferred replacement vendor
          </div>

          {!addingVendor ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <select
                  value={preferredVendorId}
                  onChange={(e) => setPreferredVendorId(e.target.value)}
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-amber-500"
                >
                  <option value="">— no preferred vendor —</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setAddingVendor(true)}
                  className="text-xs font-semibold text-amber-500 hover:text-amber-400 whitespace-nowrap"
                  title="Create a new vendor and select it"
                >
                  + New vendor
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 bg-zinc-950 border border-zinc-700 rounded-lg p-3">
              <div className="text-[10px] uppercase tracking-wider text-amber-500 font-semibold">
                Add new vendor
              </div>
              <input
                type="text"
                value={newVendorName}
                onChange={(e) => setNewVendorName(e.target.value)}
                placeholder="Vendor name (required)"
                autoFocus
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-amber-500"
              />
              <input
                type="url"
                value={newVendorWebsite}
                onChange={(e) => setNewVendorWebsite(e.target.value)}
                placeholder="Default storefront URL (optional)"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-sm text-white font-mono focus:outline-none focus:border-amber-500"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setAddingVendor(false); setNewVendorName(''); setNewVendorWebsite(''); }}
                  disabled={busy}
                  className="text-xs text-zinc-400 hover:text-white px-2"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={createVendorInline}
                  disabled={busy || !newVendorName.trim()}
                  className="text-xs font-semibold bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-3 py-1 rounded-md"
                >
                  {busy ? 'Adding…' : 'Add vendor'}
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">
              Item-specific reorder URL
              <span className="text-zinc-500 normal-case font-normal ml-1">
                (optional — overrides vendor&apos;s default)
              </span>
            </label>
            <input
              type="url"
              value={vendorItemUrl}
              onChange={(e) => setVendorItemUrl(e.target.value)}
              placeholder={selectedVendor?.website ? `falls back to: ${selectedVendor.website}` : 'https://…'}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-sm text-white font-mono focus:outline-none focus:border-amber-500"
            />
            {effectiveUrl && (
              <p className="text-[10px] text-zinc-500 mt-1 truncate">
                Effective reorder link:{' '}
                <a
                  href={effectiveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 underline"
                >
                  {effectiveUrl}
                </a>
              </p>
            )}
          </div>
        </section>

        {error && (
          <div className="bg-red-900/30 border border-red-800/40 text-red-200 rounded-lg p-2 text-[12px]">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
          <button
            type="button"
            onClick={() => !busy && onClose()}
            disabled={busy}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-white disabled:opacity-50"
          >
            Close
          </button>
          <button
            type="button"
            onClick={saveVendor}
            disabled={busy}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-semibold rounded-lg"
          >
            {busy ? 'Saving…' : 'Save vendor'}
          </button>
        </div>
      </div>
    </div>
  )
}
