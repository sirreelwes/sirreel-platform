'use client'

/**
 * Photo gallery on a subcontracted vehicle's page.
 *
 * The point is quoting speed: a client asking "what does it look
 * like?" gets an answer without a round trip to the partner. Photos
 * are private-blob backed, so every <img> points at the gated proxy
 * (/api/sub-rentals/vehicles/[id]/photos/[photoId]) rather than a raw
 * blob URL — the same contract the owned-fleet catalog uses.
 *
 * The primary photo is the one a future quote sheet will lead with,
 * which is why promoting one is a first-class action here.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

interface Photo {
  id: string
  caption: string | null
  sortOrder: number
  isPrimary: boolean
}

export default function VehiclePhotosCard({ vehicleId }: { vehicleId: string }) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/sub-rentals/vehicles/${vehicleId}/photos`, { cache: 'no-store' })
      if (r.status === 403) { setError('Pricing access required.'); return }
      const j = await r.json()
      setPhotos(j.photos ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed')
    } finally {
      setLoading(false)
    }
  }, [vehicleId])

  useEffect(() => { load() }, [load])

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true); setError(null)
    try {
      // One request per file — the endpoint takes a single image so the
      // size/type rejection points at a specific photo instead of
      // failing a whole batch anonymously.
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        const r = await fetch(`/api/sub-rentals/vehicles/${vehicleId}/photos`, { method: 'POST', body: fd })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error ?? `upload failed (${r.status})`)
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const mutate = async (photoId: string, body: Record<string, unknown>) => {
    setError(null)
    try {
      const r = await fetch(`/api/sub-rentals/vehicles/${vehicleId}/photos/${photoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error ?? `update failed (${r.status})`)
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'update failed')
    }
  }

  const remove = async (photoId: string) => {
    setError(null)
    try {
      const r = await fetch(`/api/sub-rentals/vehicles/${vehicleId}/photos/${photoId}`, { method: 'DELETE' })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error ?? `delete failed (${r.status})`)
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'delete failed')
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Photos</h2>
          <p className="text-xs text-gray-500 mt-0.5">What you send a client who asks to see the unit.</p>
        </div>
        <div className="shrink-0">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            multiple
            onChange={(e) => upload(e.target.files)}
            className="hidden"
            id={`photo-upload-${vehicleId}`}
          />
          <label
            htmlFor={`photo-upload-${vehicleId}`}
            className={`px-2.5 py-1 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer inline-block ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
          >
            {uploading ? 'Uploading…' : '+ Photos'}
          </label>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</div>
      )}

      {loading ? (
        <div className="p-6 text-sm text-gray-500 text-center">Loading photos…</div>
      ) : photos.length === 0 ? (
        <div className="p-6 text-sm text-gray-500 text-center">
          No photos yet. Add a few so a quote can go out with the unit pictured — jpg, png, webp or heic, up to 10 MB each.
        </div>
      ) : (
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {photos.map((p) => (
            <figure key={p.id} className="group relative border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/sub-rentals/vehicles/${vehicleId}/photos/${p.id}`}
                alt={p.caption ?? 'Vehicle photo'}
                className="w-full h-32 object-cover"
              />
              {p.isPrimary && (
                <span className="absolute top-1.5 left-1.5 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-600 text-white">
                  Primary
                </span>
              )}
              <figcaption className="px-2 py-1.5 flex items-center justify-between gap-1 text-[11px]">
                {!p.isPrimary ? (
                  <button onClick={() => mutate(p.id, { isPrimary: true })} className="text-blue-700 hover:underline">
                    Make primary
                  </button>
                ) : (
                  <span className="text-gray-400">Lead photo</span>
                )}
                <button onClick={() => remove(p.id)} className="text-rose-600 hover:underline">Delete</button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  )
}
