'use client'

/**
 * Naming a written-in row off the catalog, on the check-out sheet.
 *
 * The row itself is old — the floor has always been able to write in
 * gear that was not on the order. What is new (2026-09-14) is that the
 * row becomes an ORDER LINE, and a line has to have a price. This is the
 * one input that decides which way that goes:
 *
 *   · picked from the catalog → the line prices itself off the client's
 *     rate card, server-side, exactly like every other line;
 *   · left as free text → the line lands UNPRICED, which stops the
 *     invoice and the client's corrected quote until an agent prices it.
 *
 * Free text stays legal on purpose. The supervisor is transcribing
 * someone else's handwriting, and a picker they cannot get past would
 * either lose the row or push them into picking something close-enough —
 * and a
 * confidently wrong rate on a client's invoice is far worse than a line
 * that visibly needs a person.
 *
 * The list opens UPWARD when there is no room under the input
 * (2026-09-16, Oliver: Sal adding a ratchet strap could only see the
 * first hit — the "Add to the order" card is the last thing above the
 * notes box, so the list ran off the bottom of the screen). Measured
 * against the viewport each time it opens; the card itself must not clip
 * it either (see CheckReportForm — the card no longer carries
 * overflow-hidden for exactly this reason).
 *
 * Deliberately does NOT guess. Nothing here auto-selects a match for
 * typed text, however good it looks: "cp battery" hitting "CP200 -
 * Battery" is a coin flip against "CP200 - Battery, High Capacity", and
 * the wrong side of that flip is money.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, Search, X } from 'lucide-react'

interface Hit {
  id: string
  code: string
  description: string
  category: { name: string } | null
}

/** max-h-60 (240px) plus the 4px gap — what the list needs to fit whole. */
const LIST_MAX_PX = 244

export interface ExtraItemValue {
  description: string
  inventoryItemId: string | null
}

export function ExtraItemPicker({
  value,
  onChange,
  disabled,
}: {
  value: ExtraItemValue
  onChange: (next: ExtraItemValue) => void
  disabled?: boolean
}) {
  const [hits, setHits] = useState<Hit[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [openUp, setOpenUp] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  // Close on an outside click. A dropdown that stays open over the next
  // row is worse than no dropdown on a screen with ten of these.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    // Already named — nothing to search for.
    if (value.inventoryItemId) { setHits([]); return }
    const q = value.description.trim()
    if (q.length < 2) { setHits([]); return }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/inventory/search?q=${encodeURIComponent(q)}&limit=6`)
        const data = await res.json().catch(() => ({}))
        if (!cancelled) { setHits(data.items ?? []); setOpen(true) }
      } catch {
        if (!cancelled) setHits([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [value.description, value.inventoryItemId])

  const named = !!value.inventoryItemId
  const showList = open && hits.length > 0 && !named

  // Which way the list opens. The list is capped at LIST_MAX_PX; if that
  // much does not fit under the box but does fit above it, open above.
  // Re-measured on scroll/resize while open, since the sheet is a long
  // scrolling page and the box moves under the viewport edge.
  useLayoutEffect(() => {
    if (!showList) return
    const measure = () => {
      const el = boxRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const below = window.innerHeight - r.bottom
      const above = r.top
      setOpenUp(below < LIST_MAX_PX && above > below)
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [showList])

  return (
    <div ref={boxRef} className="relative flex-1 min-w-0">
      <div className="relative">
        <input
          value={value.description}
          disabled={disabled}
          onChange={(e) =>
            // Typing after a pick un-names it: the text no longer
            // describes the item that would be priced.
            onChange({ description: e.target.value, inventoryItemId: null })
          }
          onFocus={() => { if (hits.length) setOpen(true) }}
          placeholder="What went out that isn't on the order"
          className={`w-full bg-lt-inner border rounded-lg pl-2.5 pr-7 py-1.5 text-[14px] text-lt-fg placeholder:text-lt-fg3 ${
            named ? 'border-chip-good-fg/40' : 'border-lt-hairline'
          }`}
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-lt-fg3">
          {named ? (
            <Check size={14} aria-hidden className="text-chip-good-fg" />
          ) : (
            <Search size={13} aria-hidden />
          )}
        </span>
      </div>

      {/* What filing this row will do, in one line. The supervisor is the
          last person who can cheaply fix it. */}
      {value.description.trim() !== '' && (
        <p className={`mt-0.5 text-[11px] ${named ? 'text-chip-good-fg' : 'text-chip-warn-fg'}`}>
          {named
            ? 'Picked from the catalog — goes on the order at the client’s rate.'
            : searching
              ? 'Looking for it in the catalog…'
              : 'Pick the item from the list to add it.'}
        </p>
      )}

      {showList && (
        <div
          className={`absolute z-20 left-0 right-0 rounded-lg border border-lt-hairline bg-lt-card shadow-lg max-h-60 overflow-y-auto ${
            openUp ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-lt-hairline">
            <span className="text-[11px] uppercase tracking-wide font-semibold text-lt-fg3">
              Is it one of these?
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="text-lt-fg3 hover:text-lt-fg"
            >
              <X size={13} aria-hidden />
            </button>
          </div>
          {hits.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => {
                // The catalog's own wording wins once it is named — it is
                // what prints on the client's paperwork.
                onChange({ description: h.description, inventoryItemId: h.id })
                setOpen(false)
              }}
              className="w-full text-left px-2.5 py-1.5 hover:bg-lt-inner border-b border-lt-hairline last:border-b-0"
            >
              <span className="block text-[13px] text-lt-fg font-medium">{h.description}</span>
              <span className="block text-[11px] text-lt-fg3">
                {h.code}
                {h.category?.name ? ` · ${h.category.name}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
