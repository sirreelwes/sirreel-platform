'use client'

/**
 * Site-wide search field (2026-09-09) — the rounded pill on the Home hero.
 *
 * The point is speed, not decoration: SirReel keeps adding equipment, and
 * a client shouldn't have to know which tile a thing lives behind. Type
 * two letters and the item, vehicle, stage or page is one Enter away.
 *
 * Backed by /api/public/search (one in-memory index over everything
 * public). Debounced 120ms with the in-flight request aborted on each
 * keystroke, so the list only ever reflects the latest query.
 *
 * Enter with a highlighted row navigates there; Enter with nothing
 * highlighted falls through to the full order-form search
 * (/order/supplies?q=…) — which means the field still works if the API
 * is down or the catalog is mid-deploy.
 *
 * `dropUp` renders the results ABOVE the field, for a placement near the
 * bottom of the viewport where a downward list would open off-screen. The
 * Home hero no longer needs it — the pill moved to the top of the tile
 * band, so its list drops down over the tiles.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X, CornerDownLeft, Loader2 } from 'lucide-react'
import { KIND_LABEL, type PublicSearchHit } from '@/lib/site/publicSearchTypes'

interface SiteSearchProps {
  /** Open the results list upward (hero placement near the fold bottom). */
  dropUp?: boolean
  placeholder?: string
  /** Compact metrics for the mobile stack. */
  size?: 'md' | 'sm'
  className?: string
}

const KIND_TINT: Record<string, string> = {
  supply: 'bg-[#7e57c2]/25 text-[#d3c2f2] border-[#7e57c2]/40',
  vehicle: 'bg-[#d99a2b]/20 text-[#f0cb85] border-[#d99a2b]/40',
  stage: 'bg-[#c0392b]/20 text-[#f0a79d] border-[#c0392b]/40',
  'standing-set': 'bg-[#2b7fd9]/20 text-[#a8cdf5] border-[#2b7fd9]/40',
  page: 'bg-white/10 text-white/70 border-white/20',
}

export function SiteSearch({
  dropUp = false,
  placeholder = 'Search equipment, vehicles, stages…',
  size = 'md',
  className = '',
}: SiteSearchProps) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PublicSearchHit[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(-1)
  const abortRef = useRef<AbortController | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const allHref = useMemo(
    () => `/order/supplies?q=${encodeURIComponent(query.trim())}`,
    [query],
  )

  // Debounced fetch. The previous request is aborted so a slow response
  // for "c" can never overwrite the list for "c-stand".
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      abortRef.current?.abort()
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    const t = setTimeout(async () => {
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      try {
        const res = await fetch(`/api/public/search?q=${encodeURIComponent(q)}`, {
          signal: ac.signal,
        })
        const json = await res.json()
        setResults(Array.isArray(json.results) ? json.results : [])
        setActive(-1)
      } catch {
        // Aborted or offline — leave the last list up rather than flashing
        // an empty state; the Enter fallback still works.
      } finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    }, 120)
    return () => clearTimeout(t)
  }, [query])

  // Click-away closes the list (but keeps what was typed).
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const go = useCallback(
    (href: string) => {
      setOpen(false)
      router.push(href)
    },
    [router],
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (results.length && open) setOpen(false)
      else setQuery('')
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!results.length) return
      e.preventDefault()
      setOpen(true)
      const dir = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => {
        const next = i + dir
        if (next < 0) return results.length - 1
        if (next >= results.length) return 0
        return next
      })
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (open && active >= 0 && results[active]) go(results[active].href)
      else if (query.trim()) go(allHref)
    }
  }

  const showList = open && query.trim().length >= 2

  const pad = size === 'sm' ? 'h-11 pl-11 pr-10 text-[15px]' : 'h-14 pl-14 pr-12 text-[16px]'
  const iconLeft = size === 'sm' ? 'left-4' : 'left-5'

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {/* Field */}
      <div className="relative">
        <Search
          className={`pointer-events-none absolute ${iconLeft} top-1/2 -translate-y-1/2 text-white/60`}
          size={size === 'sm' ? 17 : 19}
          aria-hidden
        />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls="site-search-results"
          aria-autocomplete="list"
          aria-label="Search the site"
          autoComplete="off"
          spellCheck={false}
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={`w-full ${pad} rounded-full bg-black/55 backdrop-blur-md border border-white/25 text-white placeholder:text-white/55 outline-none transition-[border-color,box-shadow,background-color] duration-200 focus:border-[#4DB1C6]/80 focus:bg-black/70 focus:shadow-[0_0_0_4px_rgba(77,177,198,0.18)] shadow-[0_10px_40px_rgba(0,0,0,0.45)]`}
          style={{ fontFamily: 'Hanken Grotesk, system-ui, sans-serif' }}
        />
        {loading ? (
          <Loader2
            className={`absolute ${size === 'sm' ? 'right-4' : 'right-5'} top-1/2 -translate-y-1/2 animate-spin text-white/50`}
            size={16}
            aria-hidden
          />
        ) : query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery('')
              setResults([])
              inputRef.current?.focus()
            }}
            className={`absolute ${size === 'sm' ? 'right-3' : 'right-4'} top-1/2 -translate-y-1/2 p-1.5 rounded-full text-white/55 hover:text-white hover:bg-white/10 transition-colors`}
          >
            <X size={15} />
          </button>
        ) : null}
      </div>

      {/* Results */}
      {showList && (
        <div
          id="site-search-results"
          role="listbox"
          className={`absolute left-0 right-0 z-30 overflow-hidden rounded-2xl border border-white/15 bg-[#0f0f11]/95 backdrop-blur-xl shadow-[0_24px_60px_rgba(0,0,0,0.6)] ${
            dropUp ? 'bottom-full mb-3' : 'top-full mt-3'
          }`}
        >
          {results.length === 0 ? (
            <div className="px-5 py-4 text-[13.5px] text-white/60">
              {loading ? 'Searching…' : `No matches for “${query.trim()}”`}
            </div>
          ) : (
            <ul className="max-h-[52vh] overflow-y-auto py-1.5">
              {results.map((r, i) => (
                <li key={r.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(r.href)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      i === active ? 'bg-white/10' : 'hover:bg-white/[0.06]'
                    }`}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-white/5">
                      {r.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.image} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Search size={14} className="text-white/35" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-medium text-white">
                        {r.label}
                      </span>
                      {r.sublabel && (
                        <span className="block truncate text-[12px] text-white/55">
                          {r.sublabel}
                        </span>
                      )}
                    </span>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${
                        KIND_TINT[r.kind] ?? KIND_TINT.page
                      }`}
                    >
                      {KIND_LABEL[r.kind]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => go(allHref)}
            className="flex w-full items-center justify-between gap-2 border-t border-white/10 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <span className="truncate">See everything for “{query.trim()}”</span>
            <CornerDownLeft size={14} className="shrink-0" aria-hidden />
          </button>
        </div>
      )}
    </div>
  )
}
