'use client'

/**
 * The four kinds of portal, one at a time.
 *
 * Wes 2026-09-05: "give three options in portals — Client Portals (people),
 * Production Company Portals, and Vendor Portals. I want to add Job
 * Portals here too (for shows or movies and this is where we control what
 * they see and who sees it)."
 *
 * Server-rendered panes, client-side switch. The panes arrive as children
 * so the page keeps its data fetching on the server; this only decides
 * which one is showing. The choice sticks in the URL hash so a reload or
 * a shared link lands on the same pane.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Building2, Clapperboard, Truck, Users } from 'lucide-react'

export type PortalKind = 'company' | 'job' | 'client' | 'vendor'

const TABS: { key: PortalKind; label: string; icon: typeof Users; hint: string }[] = [
  { key: 'company', label: 'Production Companies', icon: Building2, hint: 'Executives who see the whole account' },
  { key: 'job', label: 'Jobs', icon: Clapperboard, hint: 'What each show’s team sees, and who' },
  { key: 'client', label: 'Clients', icon: Users, hint: 'People who have signed in' },
  { key: 'vendor', label: 'Vendors', icon: Truck, hint: 'Partner links for sub-rentals' },
]

export function PortalsTabs({
  counts,
  panes,
}: {
  counts: Record<PortalKind, number>
  panes: Record<PortalKind, ReactNode>
}) {
  const [active, setActive] = useState<PortalKind>('company')

  useEffect(() => {
    const h = window.location.hash.replace('#', '') as PortalKind
    if (TABS.some((t) => t.key === h)) setActive(h)
  }, [])

  function pick(k: PortalKind) {
    setActive(k)
    window.history.replaceState(null, '', `#${k}`)
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
      {panes[active]}
    </div>
  )
}
