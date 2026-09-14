'use client'

/**
 * The five kinds of portal, one at a time.
 *
 * Wes 2026-09-05: "give three options in portals — Client Portals (people),
 * Production Company Portals, and Vendor Portals. I want to add Job
 * Portals here too (for shows or movies and this is where we control what
 * they see and who sees it)."
 *
 * Wes 2026-09-11: "all of these should be Partners, not vendors. Vendors are
 * companies that serve SirReel: plumber, electrician etc. Partners provide
 * services for clients along with us." So the old Vendors tab is PARTNERS,
 * and VENDORS is its own tab for the companies that serve us.
 *
 * Server-rendered panes, client-side switch. The panes arrive as children
 * so the page keeps its data fetching on the server; this only decides
 * which one is showing. The choice sticks in the URL hash so a reload or
 * a shared link lands on the same pane.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Building2, Clapperboard, Handshake, Search, Users, Wrench, X } from 'lucide-react'
import { PortalSearchProvider } from '@/components/crm/PortalSearch'

export type PortalKind = 'company' | 'job' | 'client' | 'partner' | 'vendor'

/** Wes 2026-09-14: one field, and it searches the pane he is looking at. */
const PLACEHOLDER: Record<PortalKind, string> = {
  company: 'Search production companies…',
  job: 'Search jobs — show, job code, order number, client, contact…',
  client: 'Search people — name or email…',
  partner: 'Search partners — partner, unit, job…',
  vendor: 'Search vendors — name, contact, trade…',
}

const TABS: { key: PortalKind; label: string; icon: typeof Users; hint: string }[] = [
  { key: 'company', label: 'Production Companies', icon: Building2, hint: 'Executives who see the whole account' },
  { key: 'job', label: 'Jobs', icon: Clapperboard, hint: 'What each show’s team sees, and who' },
  { key: 'client', label: 'Clients', icon: Users, hint: 'People who have signed in' },
  { key: 'partner', label: 'Partners', icon: Handshake, hint: 'Serve our clients alongside us' },
  { key: 'vendor', label: 'Vendors', icon: Wrench, hint: 'Companies that serve SirReel' },
]

const HASH: Record<PortalKind, string> = { company: 'company', job: 'job', client: 'client', partner: 'partners', vendor: 'vendors' }

/** `#vendor` is every link written before 2026-09-11 — emails already sent,
 *  action items, scripts — and all of them meant partners. */
const FROM_HASH: Record<string, PortalKind> = {
  company: 'company', job: 'job', client: 'client',
  partners: 'partner', partner: 'partner', vendor: 'partner',
  vendors: 'vendor',
}

export function PortalsTabs({
  counts,
  panes,
}: {
  counts: Record<PortalKind, number>
  panes: Record<PortalKind, ReactNode>
}) {
  const [active, setActive] = useState<PortalKind>('company')
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const h = FROM_HASH[window.location.hash.replace('#', '')]
    if (h) setActive(h)
  }, [])

  // "/" from anywhere on the page puts the cursor in the field. The point
  // of this is not scrolling to find a job, so it shouldn't cost a mouse
  // trip to the top either.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function pick(k: PortalKind) {
    setActive(k)
    window.history.replaceState(null, '', `#${HASH[k]}`)
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-5">
        {TABS.map((t) => {
          const Icon = t.icon
          const on = active === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => pick(t.key)}
              className={`text-left rounded-xl border px-3.5 py-2.5 min-w-[160px] transition-colors ${
                on ? 'border-lt-fg bg-lt-card' : 'border-lt-hairline bg-lt-card hover:border-lt-fg3'
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className={`w-4 h-4 ${on ? 'text-lt-fg' : 'text-lt-fg3'}`} />
                <span className={`text-sm font-semibold ${on ? 'text-lt-fg' : 'text-lt-fg2'}`}>{t.label}</span>
                <span className="ml-auto text-xs text-lt-fg3 tabular-nums">{counts[t.key]}</span>
              </div>
              <div className="text-[11px] text-lt-fg3 mt-0.5">{t.hint}</div>
            </button>
          )
        })}
      </div>

      <div className="relative mb-4">
        <Search className="w-4 h-4 text-lt-fg3 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setQuery('') }}
          placeholder={PLACEHOLDER[active]}
          aria-label={PLACEHOLDER[active]}
          className="w-full bg-lt-card border border-lt-hairline rounded-lg pl-9 pr-9 py-2.5 text-sm text-lt-fg placeholder:text-lt-fg3 focus:outline-none focus:border-lt-fg2 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => { setQuery(''); searchRef.current?.focus() }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-lt-fg3 hover:text-lt-fg"
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <PortalSearchProvider query={query}>{panes[active]}</PortalSearchProvider>
    </div>
  )
}
