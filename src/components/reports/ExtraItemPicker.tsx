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
 * The list is SIZED AND PLACED to fit what is actually on screen
 * (2026-09-16 and again 2026-09-17, Oliver relaying the warehouse: Sal
 * adding a ratchet strap could only ever see the first hit). Three
 * separate things cut it off, and all three had to go:
 *
 *   1. the "Add to the order" card clipped it — it carried
 *      overflow-hidden for its rounded corners, so the menu died at the
 *      card's bottom edge wherever it was on screen (see CheckReportForm,
 *      which must not get that class back);
 *   2. the card is the last thing above the notes box, so even unclipped
 *      the menu ran under the bottom of the window — it opens UPWARD when
 *      that buys it room;
 *   3. it was a fixed 240px tall, so on a laptop viewport NEITHER side had
 *      enough and it was cut off whichever way it opened. It now takes the
 *      height that is really there, and when the field is jammed against an
 *      edge it scrolls itself into view once rather than rendering a
 *      two-line sliver.
 *
 * Measured against the nearest SCROLLING ancestor, not the window: the
 * staff shell's <main> is `overflow-y-auto`, and that edge is what clips.
 *
 * Deliberately does NOT guess. Nothing here auto-selects a match for
 * typed text, however good it looks: "cp battery" hitting "CP200 -
 * Battery" is a coin flip against "CP200 - Battery, High Capacity", and
 * the wrong side of that flip is money.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import { placeMenu, MENU_IDEAL_PX } from '@/lib/warehouse/menuPlacement'

interface Hit {
  id: string
  code: string
  description: string
  category: { name: string } | null
}

/**
 * What can actually cut this menu off: the nearest scrolling (or hidden)
 * ancestors, narrowed to the window. Measuring against `window` alone is
 * wrong the moment the menu lives inside a scroll container whose bottom
 * edge is above the fold — which is exactly the staff shell.
 */
function clipBounds(el: HTMLElement): { top: number; bottom: number } {
  let top = 0
  let bottom = window.innerHeight
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflowY = getComputedStyle(p).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden') {
      const r = p.getBoundingClientRect()
      top = Math.max(top, r.top)
      bottom = Math.min(bottom, r.bottom)
    }
  }
  return { top, bottom }
}

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
  // Which way the menu opens and how tall it may be, measured — never
  // assumed. Starts at the ideal so the first paint is not a sliver.
  const [place, setPlace] = useState({ up: false, maxHeight: MENU_IDEAL_PX })
  const boxRef = useRef<HTMLDivElement | null>(null)
  /** One nudge per opening, so a cramped field cannot scroll on a loop. */
  const nudged = useRef(false)

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

  // Where the menu goes and how tall it is. Re-measured on scroll and
  // resize while it is open, because the sheet is a long scrolling page
  // and the field moves toward the edge under the supervisor's thumb.
  useLayoutEffect(() => {
    if (!showList) {
      nudged.current = false
      return
    }
    let frame = 0
    const measure = () => {
      const el = boxRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const bounds = clipBounds(el)
      const next = placeMenu({
        fieldTop: r.top,
        fieldBottom: r.bottom,
        boundsTop: bounds.top,
        boundsBottom: bounds.bottom,
      })
      if (next.nudge && !nudged.current) {
        // Jammed against an edge with nowhere to open. Bring the field
        // into the middle so there IS somewhere, then measure again — a
        // two-line sliver is what the warehouse was complaining about.
        nudged.current = true
        el.scrollIntoView({ block: 'center' })
        frame = requestAnimationFrame(measure)
        return
      }
      setPlace((prev) =>
        prev.up === next.up && prev.maxHeight === next.maxHeight
          ? prev
          : { up: next.up, maxHeight: next.maxHeight },
      )
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      if (frame) cancelAnimationFrame(frame)
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
          style={{ maxHeight: place.maxHeight }}
          className={`absolute z-20 left-0 right-0 rounded-lg border border-lt-hairline bg-lt-card shadow-lg overflow-y-auto ${
            place.up ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {/* Sticky: once the rows scroll, the question and the way out
              of the menu must not scroll away with them. */}
          <div className="sticky top-0 z-10 bg-lt-card flex items-center justify-between px-2.5 py-1.5 border-b border-lt-hairline">
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
