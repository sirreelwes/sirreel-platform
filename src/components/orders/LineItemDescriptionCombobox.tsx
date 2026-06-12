'use client'

/**
 * Live inventory combobox for the line-item description field.
 *
 * One input, one flow. Typing here drives a debounced query against
 * `/api/catalog/search` and renders a dropdown of inventory items +
 * asset categories matching the entered tokens. Selecting a hit binds
 * the row to the catalog entry and lets the caller pre-fill rate +
 * department. Ignoring the dropdown and continuing to type is the
 * "custom line item" path — a quiet chip replaces the old red
 * "No catalog match" warning. Custom is a valid choice.
 *
 * Keyboard contract:
 *   ↑ / ↓     — move highlight through the dropdown
 *   Enter     — if a hit is highlighted, pick it; otherwise emit
 *               `onCommit` (parent advances to next field / row)
 *   Esc       — dismiss the dropdown, keep the typed text as custom
 *   Tab       — closes the dropdown, browser tab-focus continues
 *
 * Token-matching upgrade lives in the API; this component just calls
 * /api/catalog/search and trusts the result order.
 */

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type ForwardedRef, type KeyboardEvent } from 'react'

export type CatalogHitType = 'INVENTORY' | 'ASSET_CATEGORY'

export interface CatalogHit {
  id: string
  type: CatalogHitType
  name: string
  department: string
  dailyRate: number
  weeklyRate: number
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
}

const DEBOUNCE_MS = 200
const FORMAT_USD = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

function LineItemDescriptionComboboxInner(
  props: LineItemDescriptionComboboxProps,
  forwardedRef: ForwardedRef<HTMLInputElement>,
) {
  const {
    value, onChange, onPickCatalog, catalogBinding, onClearCatalog, onCommit,
    placeholder, autoFocus, className, hideCustomChip,
  } = props

  const [results, setResults] = useState<CatalogHit[]>([])
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // Expose the underlying input ref to parent for focus management
  // (new-quote uses this to focus the freshly-appended row).
  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement)
  const listboxId = useId()
  const lastQueryRef = useRef('')
  // Hard close-flag that locks the dropdown shut until the rep types
  // again. Belt-and-suspenders next to `dismissed` (state) — fixes a
  // post-pick race where an in-flight fetch's response could re-open
  // the dropdown a frame after pick(). Set true in pick(); cleared on
  // the next keystroke. Ref + state both: ref blocks the response
  // handler from re-opening within the same paint, state blocks the
  // debounce-fetch effect on subsequent renders.
  const justPickedRef = useRef(false)

  // Debounced fetch.
  useEffect(() => {
    if (justPickedRef.current) return
    if (dismissed) return
    const trimmed = value.trim()
    if (trimmed.length < 2) {
      setResults([])
      setOpen(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const handle = setTimeout(async () => {
      lastQueryRef.current = trimmed
      try {
        const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(trimmed)}&limit=10`)
        if (!res.ok) {
          if (!cancelled) { setResults([]); setOpen(false) }
          return
        }
        const data = await res.json()
        if (cancelled) return
        if (justPickedRef.current) return
        if (lastQueryRef.current !== trimmed) return
        const hits = (data.results ?? []) as CatalogHit[]
        setResults(hits)
        setOpen(hits.length > 0)
        setHighlight(0)
      } catch {
        if (!cancelled) { setResults([]); setOpen(false) }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [value, dismissed])

  const handleFocus = () => {
    // Refocus alone does NOT reopen the dropdown — opening requires
    // a fresh keystroke. Closes the post-pick race where the input
    // retains focus (preventDefault on the dropdown click) and the
    // focus event would otherwise clear `dismissed` and let the
    // effect re-fetch.
  }

  const handleChange = (next: string) => {
    // Keystrokes are the only path back into the open state. Both
    // flags reset so the debounced fetch effect can run again.
    justPickedRef.current = false
    onChange(next)
    setDismissed(false)
    // Only auto-unbind when the rep deletes the description
    // entirely. Partial edits (typos, "x5" suffix, etc.) keep the
    // binding — that mirrors the order-detail modal's longstanding
    // pattern where the rep can pick a catalog item AND customize
    // the invoice description. Picking a different item from the
    // dropdown explicitly replaces the binding.
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

      {open && results.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          // Size to content: at least as wide as the input, grows up
          // to ~480px so long item names render in full. White-space
          // on each row name wraps instead of ellipsizing — keeps
          // "Caravan Canopy 10x10 EZ-Up — Black" readable end-to-
          // end. Inline styles for the sizing trio so tailwind's
          // arbitrary-value class isn't required.
          style={{ minWidth: '100%', width: 'max-content', maxWidth: '480px' }}
          className="absolute z-30 left-0 top-full mt-1 bg-lt-card border border-lt-hairline rounded shadow-lg max-h-72 overflow-auto"
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
              className={`flex items-start justify-between gap-3 px-3 py-2 text-sm cursor-pointer ${
                idx === highlight ? 'bg-amber-50' : 'bg-lt-card hover:bg-lt-inner/60'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-lt-fg font-medium whitespace-normal break-words">{r.name}</div>
                <div className="text-[11px] text-lt-fg3 whitespace-normal">
                  {r.department.replace(/_/g, ' ')}
                  {r.type === 'ASSET_CATEGORY' && <span className="ml-1 text-amber-700">· category</span>}
                </div>
              </div>
              <div className="text-xs font-mono text-lt-fg2 shrink-0 pt-0.5">{FORMAT_USD(r.dailyRate)}/d</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export const LineItemDescriptionCombobox = forwardRef<HTMLInputElement, LineItemDescriptionComboboxProps>(
  LineItemDescriptionComboboxInner,
)
LineItemDescriptionCombobox.displayName = 'LineItemDescriptionCombobox'
