'use client'

/**
 * A name box that can BIND to the warehouse catalog — the swap-in on a
 * line, or a row added at pickup, on the check-out report.
 *
 * Wes, 2026-09-12: the dock has to be able to make the swap or add the
 * item itself, because the driver leaves with a copy of the exact order.
 * The rate follows only when the line points at a catalog row, so the
 * box searches /api/warehouse/catalog (names and codes, no rates — the
 * yard may not see pricing) and picking a hit binds the id. Typing
 * freely still works: the row goes on at $0 with the red flag and the
 * agent prices it. The chip under the box says which of the two the
 * supervisor is about to file.
 *
 * Kept deliberately smaller than the sales combobox: no packages, no
 * partner units, no vehicles — none of those are pull-sheet edits.
 */

import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'

export interface DockCatalogHit {
  id: string
  code: string
  description: string
  department: string
}

export function DockCatalogPicker({
  value,
  onChange,
  bound,
  onBind,
  onUnbind,
  placeholder,
  autoFocus,
  className,
}: {
  value: string
  onChange: (next: string) => void
  /** The catalog row this name is bound to, if any. */
  bound: { id: string; code: string } | null
  onBind: (hit: DockCatalogHit) => void
  onUnbind: () => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
}) {
  const [hits, setHits] = useState<DockCatalogHit[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [searching, setSearching] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const seq = useRef(0)

  // Search what is typed, but only while the name is NOT bound — a bound
  // name is settled, and re-searching it on every keystroke would offer
  // to replace the thing the supervisor just chose.
  useEffect(() => {
    const q = value.trim()
    if (bound || q.length < 2) { setHits([]); setOpen(false); return }
    const mine = ++seq.current
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/warehouse/catalog?q=${encodeURIComponent(q)}`)
        const data = await res.json().catch(() => ({}))
        if (mine !== seq.current) return
        const list: DockCatalogHit[] = Array.isArray(data.results) ? data.results : []
        setHits(list)
        setActive(0)
        setOpen(list.length > 0)
      } catch {
        if (mine === seq.current) { setHits([]); setOpen(false) }
      } finally {
        if (mine === seq.current) setSearching(false)
      }
    }, 180)
    return () => clearTimeout(t)
  }, [value, bound])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pick = (hit: DockCatalogHit) => {
    onBind(hit)
    setOpen(false)
    setHits([])
  }

  return (
    <div ref={boxRef} className={`relative ${className ?? ''}`}>
      <div className="relative">
        <input
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => {
            onChange(e.target.value)
            // Editing a bound name un-binds it: the catalog row no longer
            // describes what is typed.
            if (bound) onUnbind()
          }}
          onFocus={() => { if (hits.length) setOpen(true) }}
          onKeyDown={(e) => {
            if (!open || hits.length === 0) return
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
            else if (e.key === 'Enter') { e.preventDefault(); pick(hits[active]) }
            else if (e.key === 'Escape') { setOpen(false) }
          }}
          placeholder={placeholder}
          className={`w-full bg-lt-inner border rounded-lg pl-2.5 pr-8 py-1.5 text-[14px] text-lt-fg placeholder:text-lt-fg3 ${
            bound ? 'border-chip-good-fg/40' : 'border-lt-hairline'
          }`}
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-lt-fg3">
          <Search size={13} aria-hidden className={searching ? 'animate-pulse' : ''} />
        </span>
      </div>

      {bound ? (
        <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-chip-good-fg">
          <span className="font-mono">{bound.code}</span>
          <span className="font-normal">· catalog item, rate follows</span>
          <button
            type="button"
            onClick={onUnbind}
            aria-label="Unbind from the catalog"
            className="ml-0.5 text-lt-fg3 hover:text-chip-bad-fg"
          >
            <X size={11} aria-hidden />
          </button>
        </span>
      ) : value.trim() ? (
        <span className="mt-1 block text-[11px] text-lt-fg3">
          Typed name — goes on at $0 with the flag; the agent prices it. Pick a catalog match to carry the rate.
        </span>
      ) : null}

      {open && hits.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 left-0 right-0 mt-1 max-h-64 overflow-auto rounded-lg border border-lt-hairline bg-lt-card shadow-lg"
        >
          {hits.map((h, i) => (
            <li
              key={h.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(h) }}
              onMouseEnter={() => setActive(i)}
              className={`px-2.5 py-1.5 cursor-pointer text-[14px] ${i === active ? 'bg-chip-warn-bg text-lt-fg' : 'text-lt-fg'}`}
            >
              <span className="font-mono text-[12px] text-lt-fg2 mr-2">{h.code}</span>
              <span>{h.description}</span>
              <span className="text-[11px] text-lt-fg3 ml-2">{h.department.replace(/_/g, ' ').toLowerCase()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
