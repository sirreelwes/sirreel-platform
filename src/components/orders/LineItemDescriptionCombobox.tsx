'use client'

/**
 * Live inventory combobox for the line-item description field.
 *
 * One input, one flow. Typing here — OR clicking into a field that
 * already has text — drives a query against `/api/catalog/search` and
 * renders a dropdown of inventory items + asset categories matching the
 * entered tokens. Selecting a hit binds the row to the catalog entry and
 * lets the caller pre-fill rate + department. Ignoring the dropdown and
 * continuing to type is the "custom line item" path — a quiet chip
 * replaces the old red "No catalog match" warning. Custom is valid.
 *
 * Re-pick without retype: focusing a field that already holds a
 * description opens the dropdown seeded with matches for the current
 * text (so a bound row surfaces its catalog siblings) WITHOUT erasing
 * anything. The existing text stays the field value until the rep
 * actually picks a new hit. Typing filters further.
 *
 * Positioning: the dropdown is rendered in a PORTAL on `document.body`
 * with fixed coordinates pinned to the input's bounding rect. Anchoring
 * to the viewport (not the row) is what keeps it from being clipped or
 * painted behind sibling rows when many comboboxes stack inside a table
 * / grid (the per-row line-items editor). Each instance owns its own
 * open / results / highlight state, so one row's dropdown never appears
 * on another.
 *
 * Keyboard contract:
 *   ↑ / ↓     — move highlight through THIS row's dropdown
 *   Enter     — if a hit is highlighted, pick it; otherwise emit
 *               `onCommit` (parent advances to next field / row)
 *   Esc       — dismiss the dropdown, keep the typed text as custom
 *   Tab       — closes the dropdown, browser tab-focus continues
 *
 * Token-matching upgrade lives in the API; this component just calls
 * /api/catalog/search and trusts the result order.
 */

import {
  forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect,
  useMemo, useRef, useState, type ForwardedRef, type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'

export type CatalogHitType = 'INVENTORY' | 'ASSET_CATEGORY' | 'PACKAGE'

export interface CatalogHitPackageMember {
  inventoryItemId: string
  name: string
  code: string
  qty: number
  dailyRate: number
  weeklyRate: number
  department: string
}

export interface CatalogHit {
  id: string
  type: CatalogHitType
  name: string
  department: string
  dailyRate: number
  weeklyRate: number
  /** Present only when type === 'PACKAGE'. Lists the inventory
   *  members that should be inserted as $0 child rows under the
   *  header. */
  items?: CatalogHitPackageMember[]
}

export interface CatalogBinding {
  id: string
  type: CatalogHitType
  name: string
}

export interface LineItemDescriptionComboboxProps {
  value: string
  onChange: (next: string) => void
  /** Called when the user clicks/Enters on a dropdown hit. Parent
   *  records the binding + may pre-fill rate / department. */
  onPickCatalog: (hit: CatalogHit) => void
  /** Current catalog binding for this row (if any). When non-null,
   *  the input shows a small "✓ {name}" pill. Editing the text away
   *  from the bound name (parent decides what counts) should call
   *  onClearCatalog. */
  catalogBinding: CatalogBinding | null
  /** Called when the rep edits the description after a catalog
   *  binding was set — parent decides whether to clear the FK. */
  onClearCatalog?: () => void
  /** Enter with no hit highlighted → parent commits this row. New-
   *  quote uses this to auto-append + focus next row. */
  onCommit?: () => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
  /** Hide the "custom item" chip even when no catalog binding is set
   *  — useful inside the order-detail modal which has its own
   *  status pills. Defaults to false. */
  hideCustomChip?: boolean
  /** Restrict search results by type — defaults to all. The admin
   *  package builder uses `['INVENTORY']` so the picker doesn't show
   *  asset categories or other packages while building. */
  types?: CatalogHitType[]
}

const DEBOUNCE_MS = 200
const MIN_QUERY = 2
// Position before paint on the client; fall back to useEffect on the
// server so SSR doesn't warn about useLayoutEffect (the dropdown only
// ever opens post-hydration, so the effect body never runs server-side).
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect
const FORMAT_USD = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

function LineItemDescriptionComboboxInner(
  props: LineItemDescriptionComboboxProps,
  forwardedRef: ForwardedRef<HTMLInputElement>,
) {
  const {
    value, onChange, onPickCatalog, catalogBinding, onClearCatalog, onCommit,
    placeholder, autoFocus, className, hideCustomChip, types,
  } = props

  const [results, setResults] = useState<CatalogHit[]>([])
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [loading, setLoading] = useState(false)
  // Fixed viewport coords for the portalled dropdown, pinned to the
  // input's rect. Null until the first measure (also keeps the portal
  // out of SSR — `open` starts false so this branch never runs server-
  // side).
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // Expose the underlying input ref to parent for focus management
  // (new-quote uses this to focus the freshly-appended row).
  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement)
  const listboxId = useId()
  const lastQueryRef = useRef('')
  // Hard close-flag that locks the dropdown shut until the rep types
  // or re-focuses. Belt-and-suspenders next to `dismissed` (state) —
  // fixes a post-pick race where an in-flight fetch's response could
  // re-open the dropdown a frame after pick(). Set true in pick();
  // cleared on the next keystroke OR on blur (so re-focusing a just-
  // picked row can re-open for another re-pick).
  const justPickedRef = useRef(false)

  // Stable primitive key for the `types` array so the search callback
  // doesn't get a new identity every render (which would thrash the
  // debounce effect).
  const typesKey = types && types.length > 0 ? types.join(',') : ''

  const runSearch = useCallback(async (trimmed: string) => {
    if (justPickedRef.current) return
    if (trimmed.length < MIN_QUERY) { setResults([]); setOpen(false); return }
    lastQueryRef.current = trimmed
    setLoading(true)
    try {
      const typesQuery = typesKey ? `&types=${encodeURIComponent(typesKey)}` : ''
      const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(trimmed)}&limit=10${typesQuery}`)
      if (!res.ok) { setResults([]); setOpen(false); return }
      const data = await res.json()
      // A newer query (or a pick) superseded this response — drop it.
      if (justPickedRef.current) return
      if (lastQueryRef.current !== trimmed) return
      const hits = (data.results ?? []) as CatalogHit[]
      setResults(hits)
      setOpen(hits.length > 0)
      setHighlight(0)
    } catch {
      setResults([]); setOpen(false)
    } finally {
      setLoading(false)
    }
  }, [typesKey])

  // Debounced fetch on typing.
  useEffect(() => {
    if (justPickedRef.current) return
    if (dismissed) return
    const trimmed = value.trim()
    if (trimmed.length < MIN_QUERY) {
      setResults([])
      setOpen(false)
      return
    }
    const handle = setTimeout(() => { void runSearch(trimmed) }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [value, dismissed, runSearch])

  // Pin the portalled dropdown to the input while it's open; follow
  // scroll/resize so it never drifts off the field.
  const updateCoords = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setCoords({ top: r.bottom, left: r.left, width: r.width })
  }, [])

  useIsomorphicLayoutEffect(() => {
    if (!open) return
    updateCoords()
    const onMove = () => updateCoords()
    // capture:true catches scrolls in any nested scroll container, not
    // just the window.
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open, updateCoords])

  const handleFocus = () => {
    // Click-to-re-pick: focusing a field that already has text opens
    // the dropdown seeded with matches for the current value WITHOUT
    // erasing it. Skipped right after a pick (justPickedRef) so the
    // act of picking — which leaves the input focused — doesn't bounce
    // the dropdown back open.
    if (justPickedRef.current) return
    if (open) return
    const trimmed = value.trim()
    if (trimmed.length < MIN_QUERY) return
    setDismissed(false)
    void runSearch(trimmed)
  }

  const handleBlur = () => {
    // Leaving the field closes the dropdown and clears the post-pick
    // lock so a later re-focus can re-open. A dropdown pick uses
    // mousedown+preventDefault, so it keeps focus and never fires blur.
    justPickedRef.current = false
    setOpen(false)
  }

  const handleChange = (next: string) => {
    // Keystrokes are a path back into the open state. Both flags reset
    // so the debounced fetch effect can run again.
    justPickedRef.current = false
    onChange(next)
    setDismissed(false)
    // Only auto-unbind when the rep deletes the description entirely.
    // Partial edits (typos, "x5" suffix, etc.) keep the binding — that
    // mirrors the order-detail modal's longstanding pattern where the
    // rep can pick a catalog item AND customize the invoice
    // description. Picking a different item from the dropdown
    // explicitly replaces the binding.
    if (catalogBinding && next.trim().length === 0) onClearCatalog?.()
  }

  const pick = useCallback((hit: CatalogHit) => {
    // Slam the dropdown shut FIRST, before parent state propagates,
    // so any in-flight fetch response sees justPickedRef and bails.
    justPickedRef.current = true
    setOpen(false)
    setResults([])
    setDismissed(true)
    onPickCatalog(hit)
    onChange(hit.name)
  }, [onPickCatalog, onChange])

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        setOpen(false)
        setDismissed(true)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      if (open && results.length > 0) {
        e.preventDefault()
        setHighlight((h) => (h + 1) % results.length)
      }
      return
    }
    if (e.key === 'ArrowUp') {
      if (open && results.length > 0) {
        e.preventDefault()
        setHighlight((h) => (h - 1 + results.length) % results.length)
      }
      return
    }
    if (e.key === 'Enter') {
      if (open && results[highlight]) {
        e.preventDefault()
        pick(results[highlight])
        // After picking, fire commit so the parent (new-quote)
        // can advance to next field / row.
        onCommit?.()
        return
      }
      if (value.trim().length > 0) {
        // Custom item commit.
        e.preventDefault()
        setOpen(false)
        onCommit?.()
      }
      return
    }
    if (e.key === 'Tab') {
      setOpen(false)
      // Browser handles tab navigation natively.
      return
    }
  }

  const showCustomChip = useMemo(() => {
    if (hideCustomChip) return false
    if (catalogBinding) return false
    return value.trim().length > 0
  }, [hideCustomChip, catalogBinding, value])

  return (
    <div className={`relative ${className ?? ''}`}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        autoFocus={autoFocus}
        placeholder={placeholder || 'Start typing to search inventory…'}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        autoComplete="off"
        className="w-full bg-lt-card border border-lt-hairline rounded px-2 py-1 text-sm text-lt-fg font-semibold focus:outline-none focus:border-amber-500"
      />

      {/* Status pill — either the catalog binding chip OR the custom
          item chip, never both. Sits at the right edge of the input. */}
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
        {catalogBinding && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 pointer-events-auto" title={`Bound to catalog: ${catalogBinding.id}`}>
            ✓ {catalogBinding.type === 'ASSET_CATEGORY' ? 'category' : 'item'}
          </span>
        )}
        {showCustomChip && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-lt-inner text-lt-fg3 border border-lt-hairline" title="No catalog binding — sent as a custom line item">
            custom
          </span>
        )}
        {loading && (
          <span className="text-[10px] text-lt-fg3 animate-pulse">…</span>
        )}
      </div>

      {/* Dropdown — portalled to <body> with fixed coords pinned to the
          input, so it floats above every sibling row instead of being
          clipped by / stacked under the table or grid it lives in. */}
      {open && results.length > 0 && coords && createPortal(
        <ul
          id={listboxId}
          role="listbox"
          // Pinned to the input's viewport rect; grows up to ~480px so
          // long item names render in full, wrapping rather than
          // ellipsizing.
          style={{
            position: 'fixed',
            top: coords.top + 4,
            left: coords.left,
            minWidth: coords.width,
            width: 'max-content',
            maxWidth: '480px',
            zIndex: 60,
            // Explicit SOLID fill (lt-card = #FFFFFF). The panel portals
            // into <body>, floating over the line-item rows — it must be
            // fully opaque so nothing behind it bleeds through. Inline so
            // it can't resolve to a transparent/utility edge case.
            backgroundColor: '#FFFFFF',
          }}
          className="bg-lt-card border border-lt-hairline rounded shadow-xl max-h-72 overflow-auto"
        >
          {results.map((r, idx) => (
            <li
              key={`${r.type}:${r.id}`}
              role="option"
              aria-selected={idx === highlight}
              onMouseEnter={() => setHighlight(idx)}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(r)
                onCommit?.()
              }}
              // Each option keeps its own SOLID fill so the highlight /
              // hover tint never blends with whatever sits behind the
              // panel. No alpha (`/60`) — that's what let rows show
              // through on hover.
              className={`flex items-start justify-between gap-3 px-3 py-2 text-sm cursor-pointer ${
                idx === highlight ? 'bg-amber-100' : 'bg-white hover:bg-lt-inner'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {r.type === 'PACKAGE' && (
                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 border border-violet-200">
                      PKG
                    </span>
                  )}
                  <div className="text-lt-fg font-medium whitespace-normal break-words">{r.name}</div>
                </div>
                <div className="text-[11px] text-lt-fg3 whitespace-normal">
                  {r.department.replace(/_/g, ' ')}
                  {r.type === 'ASSET_CATEGORY' && <span className="ml-1 text-amber-700">· category</span>}
                  {r.type === 'PACKAGE' && r.items && (
                    <span className="ml-1 text-violet-700">· {r.items.length} item{r.items.length === 1 ? '' : 's'}</span>
                  )}
                </div>
              </div>
              <div className="text-xs font-mono text-lt-fg2 shrink-0 pt-0.5">{FORMAT_USD(r.dailyRate)}/d</div>
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  )
}

export const LineItemDescriptionCombobox = forwardRef<HTMLInputElement, LineItemDescriptionComboboxProps>(
  LineItemDescriptionComboboxInner,
)
LineItemDescriptionCombobox.displayName = 'LineItemDescriptionCombobox'
