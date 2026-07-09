'use client'

/**
 * Asset summary panel — opened by clicking a unit's NAME on the gantt asset
 * view. Vehicle at a glance: category-generic picture, specs (make/model/year,
 * mileage, VIN, status), a concise maintenance summary (open first, then recent
 * completed), fleet notes, and the condition-tier setter (Best/Good/Workhorse).
 *
 * This panel is the CANONICAL tier-setter home (the unit-row "…" menu points
 * here). Viewing is any signed-in user; editing notes/tier is fleet
 * (canAssignAssets) — enforced server-side by PATCH /assets/[id]/summary,
 * mirrored here via the canEdit prop. The summary endpoint never returns the
 * CRH §6.2 internal-only insurance fields.
 */
import { useCallback, useEffect, useState } from 'react'

// Keep in lockstep with the gantt page's TIER_COLORS/TIER_LABELS (dot + legend).
const TIERS = [
  { value: 'PREMIUM', label: 'Best', color: '#22c55e' },
  { value: 'STANDARD', label: 'Good', color: '#f97316' },
  { value: 'ECONOMY', label: 'Workhorse', color: '#eab308' },
] as const

interface AssetSummaryPanelProps {
  assetId: string
  canEdit: boolean // canAssignAssets — gates notes edit + tier setter (server re-checks)
  onClose: () => void
  onChanged?: () => void // fired after a saved edit so the board can refresh (tier dot)
}

function fDate(d: string | null | undefined): string {
  if (!d) return ''
  return new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fCost(m: { actualCost?: unknown; estimatedCost?: unknown }): string {
  const v = m.actualCost ?? m.estimatedCost
  if (v === null || v === undefined) return ''
  const n = Number(v)
  if (!Number.isFinite(n) || n === 0) return ''
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}${m.actualCost == null ? ' est.' : ''}`
}

const MAINT_STATUS_BADGE: Record<string, string> = {
  SCHEDULED: 'bg-amber-100 text-amber-700',
  IN_PROGRESS: 'bg-rose-100 text-rose-700',
  COMPLETED: 'bg-gray-100 text-gray-500',
  CANCELLED: 'bg-gray-100 text-gray-400 line-through',
}

export function AssetSummaryPanel({ assetId, canEdit, onClose, onChanged }: AssetSummaryPanelProps) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [imgOk, setImgOk] = useState(true)
  const [photoIdx, setPhotoIdx] = useState(0)
  const [photoOk, setPhotoOk] = useState(true)
  const [notesDraft, setNotesDraft] = useState('')
  const [notesDirty, setNotesDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/scheduling/assets/${assetId}/summary`)
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.reason || json.error || `failed (${res.status})`)
      setData(json.asset)
      setNotesDraft(json.asset.notes ?? '')
      setNotesDirty(false)
      setPhotoIdx(0)
      setPhotoOk(true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [assetId])

  useEffect(() => {
    void load()
  }, [load])

  async function patch(body: Record<string, unknown>) {
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch(`/api/scheduling/assets/${assetId}/summary`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.reason || json.error || `save failed (${res.status})`)
      setData((d: any) => (d ? { ...d, ...json.asset } : d))
      if ('notes' in body) setNotesDirty(false)
      onChanged?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const spec = (label: string, value: unknown) => (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-gray-400 font-semibold">{label}</div>
      <div className="text-[12px] text-gray-900">{value === null || value === undefined || value === '' ? '—' : String(value)}</div>
    </div>
  )

  const maintRow = (m: any) => (
    <div key={m.id} className="flex items-start gap-2 py-1 border-b border-gray-50 last:border-0">
      <span className={`text-[8px] font-bold px-1 py-0.5 rounded flex-shrink-0 mt-0.5 ${MAINT_STATUS_BADGE[m.status] || 'bg-gray-100 text-gray-500'}`}>
        {String(m.status).replace('_', ' ')}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-gray-900 truncate">{m.title}</div>
        <div className="text-[9px] text-gray-400">
          {String(m.type).toLowerCase()} · {fDate(m.startDate)}{m.endDate ? ` – ${fDate(m.endDate)}` : ' – open'}
          {m.vendor ? ` · ${m.vendor}` : ''}{fCost(m) ? ` · ${fCost(m)}` : ''}
        </div>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!saving) onClose() }}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : !data ? (
          <div className="p-8 text-center text-sm text-rose-600">{err || 'Failed to load asset.'}</div>
        ) : (
          <>
            {/* Header hero — the most recent fleet CHECKOUT photos (via the
                session-gated /api/fleet/photos proxy, never a raw blob URL),
                with the generic category picture demoted to a thumbnail.
                Fallback when the asset has no inspection photos: the category
                picture IS the hero and the thumbnail is skipped. */}
            {(() => {
              const photoIds: string[] = photoOk ? (data.featuredInspection?.photoIds ?? []) : []
              const hasPhotos = photoIds.length > 0
              const idx = Math.min(photoIdx, Math.max(0, photoIds.length - 1))
              const catImg = data.category?.hasImage && imgOk
              return (
                <div className="relative">
                  {hasPhotos ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/fleet/photos/${photoIds[idx]}`}
                        alt={`Checkout photo ${idx + 1} of ${photoIds.length}`}
                        className="w-full h-44 object-cover rounded-t-xl bg-gray-100"
                        onError={() => setPhotoOk(false)}
                      />
                      {/* Inspection recency badge */}
                      <span className="absolute bottom-2 left-2 text-[9px] font-semibold bg-black/60 text-white px-1.5 py-0.5 rounded">
                        {data.featuredInspection.type === 'CHECKOUT' ? 'Checkout' : String(data.featuredInspection.type).toLowerCase()} · {fDate(data.featuredInspection.inspectionDate)}
                      </span>
                      {/* Pager (only when several photos) */}
                      {photoIds.length > 1 && (
                        <>
                          <button
                            onClick={() => setPhotoIdx((i) => (i - 1 + photoIds.length) % photoIds.length)}
                            className="absolute left-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/40 hover:bg-black/60 text-white text-xs leading-none"
                            aria-label="Previous photo"
                          >‹</button>
                          <button
                            onClick={() => setPhotoIdx((i) => (i + 1) % photoIds.length)}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/40 hover:bg-black/60 text-white text-xs leading-none"
                            aria-label="Next photo"
                          >›</button>
                          <span className="absolute bottom-2 right-2 text-[9px] font-semibold bg-black/60 text-white px-1.5 py-0.5 rounded">
                            {idx + 1}/{photoIds.length}
                          </span>
                        </>
                      )}
                      {/* Generic category picture — demoted to a small thumbnail. */}
                      {catImg && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/scheduling/assets/${assetId}/category-image`}
                          alt={data.category?.name || 'Category'}
                          title={`${data.category?.name || 'Category'} (generic)`}
                          className="absolute top-2 left-2 w-14 h-10 object-cover rounded border-2 border-white/90 shadow"
                          onError={() => setImgOk(false)}
                        />
                      )}
                    </>
                  ) : (
                    catImg && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/scheduling/assets/${assetId}/category-image`}
                        alt={data.category?.name || 'Vehicle'}
                        className="w-full h-36 object-cover rounded-t-xl bg-gray-100"
                        onError={() => setImgOk(false)}
                      />
                    )
                  )}
                  <button
                    onClick={onClose}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 shadow text-gray-500 hover:text-gray-900 text-lg leading-none"
                  >×</button>
                </div>
              )
            })()}
            <div className="p-5">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <h2 className="text-lg font-semibold text-gray-900 truncate">{data.unitName}</h2>
                <span className="text-[11px] text-gray-400 flex-shrink-0">{data.category?.name}</span>
              </div>

              {/* Specs */}
              <div className="grid grid-cols-3 gap-x-3 gap-y-2 mt-3">
                {spec('Make / Model', [data.make, data.model].filter(Boolean).join(' ') || null)}
                {spec('Year', data.year)}
                {spec('Mileage', data.mileage != null ? Number(data.mileage).toLocaleString('en-US') : null)}
                {spec('VIN', data.vin)}
                {spec('Status', String(data.status).replace('_', ' '))}
                {spec('In fleet', data.isActive ? 'Active' : 'Inactive')}
              </div>

              {/* Condition tier — canonical setter (fleet); read-only chip otherwise */}
              <div className="mt-4">
                <div className="text-[9px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Condition tier</div>
                <div className="flex items-center gap-1.5">
                  {TIERS.map((t) => {
                    const active = data.tier === t.value
                    if (!canEdit && !active) return null
                    return (
                      <button
                        key={t.value}
                        disabled={!canEdit || saving || active}
                        onClick={() => patch({ tier: t.value })}
                        className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border transition-colors ${
                          active ? 'border-gray-800 bg-gray-800 text-white font-semibold' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        } ${!canEdit ? 'cursor-default' : 'disabled:opacity-60'}`}
                      >
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: t.color }} />
                        {t.label}
                      </button>
                    )
                  })}
                  {!canEdit && <span className="text-[9px] text-gray-400 italic ml-1">set by fleet</span>}
                </div>
              </div>

              {/* Maintenance & repairs */}
              <div className="mt-4">
                <div className="text-[9px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Maintenance & repairs</div>
                {data.maintenance?.open?.length === 0 && data.maintenance?.recent?.length === 0 ? (
                  <div className="text-[11px] text-gray-400 italic">No maintenance on record.</div>
                ) : (
                  <div className="max-h-44 overflow-y-auto pr-1">
                    {(data.maintenance?.open ?? []).map(maintRow)}
                    {(data.maintenance?.recent ?? []).map(maintRow)}
                  </div>
                )}
              </div>

              {/* Fleet notes */}
              <div className="mt-4">
                <div className="text-[9px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Fleet notes</div>
                {canEdit ? (
                  <>
                    <textarea
                      value={notesDraft}
                      rows={3}
                      placeholder="Quirks, damage to watch, prep reminders…"
                      onChange={(e) => { setNotesDraft(e.target.value); setNotesDirty(true) }}
                      className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-[12px] text-gray-900 placeholder:text-gray-300 resize-y"
                    />
                    {notesDirty && (
                      <div className="flex justify-end mt-1">
                        <button
                          onClick={() => patch({ notes: notesDraft })}
                          disabled={saving}
                          className="text-[11px] font-semibold bg-amber-600 hover:bg-amber-500 text-white px-3 py-1 rounded disabled:opacity-40"
                        >
                          {saving ? 'Saving…' : 'Save notes'}
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-[12px] text-gray-700 whitespace-pre-wrap">{data.notes || <span className="text-gray-400 italic">No notes.</span>}</div>
                )}
              </div>

              {err && <p className="text-xs text-rose-600 mt-3">{err}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
