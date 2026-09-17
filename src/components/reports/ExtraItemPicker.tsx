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
 * The list is PORTALLED to <body> with fixed coordinates, exactly like
 * the order form's line-item combobox, and for the same reason. Oliver
 * relayed this one twice (2026-09-16 and again 2026-09-17, with a photo
 * of the screen): "the dropdown box can't be seen fully, which makes it
 * harder for warehouse to add items during checkout." Sal, adding a
 * ratchet strap, could see the question and one hit. Two different edges
 * were cutting it:
 *
 *   · the "Add to the order" card clipped it — the panel was a DOM
 *     descendant of a box with overflow-hidden, so it died at the card's
 *     bottom edge wherever it sat on screen;
 *   · the card is the last thing above the notes box, so even unclipped
 *     it ran under the bottom of the staff shell's scrolling <main>.
 *
 * A portal answers the first (the panel is no longer inside anything
 * that can clip it) and `placeDropdown` answers the second — it opens
 * the list above the field when below is cramped, and never asks for
 * more height than the visible screen actually has. Deliberately the
 * SAME rule the line-item combobox uses rather than a second one beside
 * it: two placement modules drift, and this catalog already taught that
 * lesson three times over (see "THREE boxes search this catalog").
 *
 * Deliberately does NOT guess. Nothing here auto-selects a match for
 * typed text, however good it looks: "cp battery" hitting "CP200 -
 * Battery" is a coin flip against "CP200 - Battery, High Capacity", and
 * the wrong side of that flip is money.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Search, X } from 'lucide-react'
import { placeDropdown, readVisibleViewport, type DropdownPlacement } from '@/lib/ui/dropdownPlacement'

interface Hit {
  id: string
  code: string
  description: string
  category: { name: string } | null
}

// useLayoutEffect warns during SSR; the dropdown only ever places itself
// in the browser. Same shim the line-item combobox uses.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

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
  const [coords, setCoords] = useState<DropdownPlacement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

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
        if (cancelled) return
        const found = (data.items ?? []) as Hit[]
        // Place the panel in the SAME commit it opens, so it is a
        // positioned overlay from its first paint rather than flashing
        // unpinned at the top of the page.
        if (found.length > 0 && inputRef.current) {
          setCoords(placeDropdown(inputRef.current.getBoundingClientRect(), readVisibleViewport(window)))
        }
        setHits(found)
        setOpen(found.length > 0)
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

  // Keep the panel pinned to the field while it is open. Placement —
  // above or below, and how tall — is decided against the VISIBLE
  // viewport, which on a phone is what the keyboard has left over.
  const updateCoords = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    setCoords(placeDropdown(el.getBoundingClientRect(), readVisibleViewport(window)))
  }, [])

  useIsomorphicLayoutEffect(() => {
    if (!showList) return
    updateCoords()
    const onMove = () => updateCoords()
    // capture:true catches scrolls in any nested scroll container — the
    // staff shell's <main> is the one that matters here, not the window.
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    // A phone keyboard opening fires on the visual viewport, not on
    // window.resize (iOS Safari).
    const vv = window.visualViewport
    vv?.addEventListener('resize', onMove)
    vv?.addEventListener('scroll', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
      vv?.removeEventListener('resize', onMove)
      vv?.removeEventListener('scroll', onMove)
    }
  }, [showList, updateCoords])

  return (
    <div className="relative flex-1 min-w-0">
      <div className="relative">
        <input
          ref={inputRef}
          value={value.description}
          disabled={disabled}
          onChange={(e) =>
            // Typing after a pick un-names it: the text no longer
            // describes the item that would be priced.
            onChange({ description: e.target.value, inventoryItemId: null })
          }
          onFocus={() => { if (hits.length) setOpen(true) }}
          // Leaving the field closes the list. The panel lives in a
          // portal, so an outside-click test against this component's
          // own subtree would call a click ON the list "outside" and
          // close it before the pick landed — every control inside the
          // panel uses mousedown+preventDefault to hold focus instead.
          onBlur={() => setOpen(false)}
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

      {showList && coords && createPortal(
        <div
          style={{
            position: 'fixed',
            top: coords.top,
            bottom: coords.bottom,
            left: coords.left,
            minWidth: coords.minWidth,
            width: 'max-content',
            maxWidth: coords.maxWidth,
            maxHeight: coords.maxHeight,
            zIndex: 60,
            // Explicit SOLID fill. The panel floats over the sheet's
            // rows, so anything less than opaque bleeds through.
            backgroundColor: '#FFFFFF',
          }}
          className="rounded-lg border border-lt-hairline shadow-lg overflow-y-auto"
        >
          {/* Sticky: once the rows scroll, the question and the way out
              of the list must not scroll away with them. */}
          <div
            className="sticky top-0 z-10 flex items-center justify-between px-2.5 py-1.5 border-b border-lt-hairline"
            style={{ backgroundColor: '#FFFFFF' }}
          >
            <span className="text-[11px] uppercase tracking-wide font-semibold text-lt-fg3">
              Is it one of these?
            </span>
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); setOpen(false) }}
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
              // mousedown, not click: the input must not blur before the
              // pick is recorded, or the panel unmounts underneath it.
              onMouseDown={(e) => {
                e.preventDefault()
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
        </div>,
        document.body,
      )}
    </div>
  )
}
