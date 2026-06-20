'use client'

/**
 * Always-visible health roll-up dot for the admin sidebar.
 *
 * Polls `/api/admin/health/latest` every 60s — read-only, never
 * triggers a live probe. Paints a 3-state colored dot using the same
 * mapping the /admin/health page uses (down=red, degraded=amber,
 * healthy=emerald). Color is supplemented by `aria-label` + `title`
 * (the WCAG "don't rely on color alone" rule) — both name the overall
 * status, list any non-healthy services by name, and include a
 * relative `checkedAt` like "checked 12m ago".
 *
 * Click → `/admin/health`. Placed in the sidebar's Admin section
 * header row so it's visible whether the section is expanded or
 * collapsed; visibility is also gated by role === ADMIN at the call
 * site in layout.tsx.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'

type ServiceStatus = 'healthy' | 'degraded' | 'down'

interface ServicePayload {
  status: ServiceStatus
  error?: string
  [k: string]: unknown
}

interface LatestResponse {
  overall: ServiceStatus | null
  services: Record<string, ServicePayload>
  checkedAt: string | null
}

// Same palette the /admin/health page uses, expressed as Tailwind
// solid-fill swatches (the page uses 900/40 backgrounds + 300 text
// for badges; the dot is a solid fill at full saturation so the
// status reads at a glance against the white sidebar).
const STATUS_BG: Record<ServiceStatus, string> = {
  healthy: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  down: 'bg-red-500',
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const diffMs = Date.now() - new Date(iso).getTime()
  if (diffMs < 0) return 'just now' // clock skew safety
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function describeNonHealthy(services: Record<string, ServicePayload>): string {
  const bad = Object.entries(services)
    .filter(([, s]) => s?.status && s.status !== 'healthy')
    .map(([name, s]) => `${name}: ${s.status}`)
  if (bad.length === 0) return 'all services healthy'
  return bad.join(', ')
}

export function AdminHealthDot() {
  const [data, setData] = useState<LatestResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch('/api/admin/health/latest', { cache: 'no-store' })
        if (!r.ok) return
        const j: LatestResponse = await r.json()
        if (!cancelled) setData(j)
      } catch {
        // swallow — dot just keeps showing prior state
      }
    }
    load()
    const t = setInterval(load, 60_000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  // No probe data yet (fresh DB, cron hasn't fired) — neutral
  // indicator with an honest tooltip rather than a misleading green.
  if (!data || !data.overall) {
    return (
      <Link
        href="/admin/health"
        aria-label="Health status unknown — no probe data yet"
        title="Health status unknown — no probe data yet. Click to run a fresh probe."
        className="inline-flex items-center px-2"
      >
        <span className="inline-block w-2 h-2 rounded-full bg-gray-300" />
      </Link>
    )
  }

  const overall = data.overall
  const bg = STATUS_BG[overall]
  const detail = describeNonHealthy(data.services)
  const checked = relativeTime(data.checkedAt)
  const tooltip =
    overall === 'healthy'
      ? `Health HEALTHY — ${detail}. Checked ${checked}.`
      : `Health ${overall.toUpperCase()} — ${detail}. Checked ${checked}.`

  return (
    <Link
      href="/admin/health"
      aria-label={tooltip}
      title={tooltip}
      className="inline-flex items-center px-2"
    >
      <span className={`inline-block w-2 h-2 rounded-full ${bg}`} />
    </Link>
  )
}
