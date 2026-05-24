'use client'

/**
 * Scheduling — control hub.
 *
 * Single landing page that surfaces the at-a-glance state of native
 * scheduling and links every diagnostic surface. Reachable at
 * /scheduling. Not in the sidebar yet — operator types the URL.
 *
 * Pure read-only. No actions on this page; each tile deep-links to
 * the page that does the action.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Summary {
  ok: boolean
  staleDays: number
  counts: {
    planyoImported: number
    cartIdStamped: number
    primaryHolds: number
    backupHolds: number
    staleHolds: number
    bookingItemsAssigned: number
    bookingAssignments: number
    categoriesPublished: number
    serviceableAssets: number
    totalAssets: number
  }
}

interface DiagTileProps {
  href: string
  title: string
  description: string
  badge?: { label: string; tone: 'neutral' | 'good' | 'warn' | 'bad' }
}

const TONE_CLASS: Record<NonNullable<DiagTileProps['badge']>['tone'], string> = {
  neutral: 'bg-zinc-100 text-zinc-700 border-zinc-200',
  good: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warn: 'bg-amber-50 text-amber-800 border-amber-200',
  bad: 'bg-rose-50 text-rose-700 border-rose-200',
}

function DiagTile({ href, title, description, badge }: DiagTileProps) {
  return (
    <Link
      href={href}
      className="block bg-white border border-zinc-200 rounded-lg p-4 hover:border-zinc-400 hover:shadow-sm transition"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-semibold text-zinc-900">{title}</div>
        {badge && (
          <span className={`text-xs px-2 py-0.5 rounded border whitespace-nowrap ${TONE_CLASS[badge.tone]}`}>
            {badge.label}
          </span>
        )}
      </div>
      <div className="text-xs text-zinc-500 mt-1.5">{description}</div>
    </Link>
  )
}

function Stat({ label, value, hint, tone = 'neutral' }: { label: string; value: number | string; hint?: string; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const valueColor = {
    neutral: 'text-zinc-900',
    good: 'text-emerald-700',
    warn: 'text-amber-700',
    bad: 'text-rose-700',
  }[tone]
  return (
    <div className="bg-white border border-zinc-200 rounded p-3">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`text-2xl font-semibold ${valueColor} mt-1`}>{value}</div>
      {hint && <div className="text-xs text-zinc-500 mt-0.5">{hint}</div>}
    </div>
  )
}

export default function SchedulingHubPage() {
  const [data, setData] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/scheduling/hub-summary')
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return
        if (!json.ok) throw new Error(json.error || 'request failed')
        setData(json)
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const c = data?.counts
  const staleTone: 'good' | 'warn' = c && c.staleHolds > 0 ? 'warn' : 'good'
  const cartIdGap = c ? c.planyoImported - c.cartIdStamped : 0
  const cartIdTone: 'good' | 'warn' = cartIdGap > 0 ? 'warn' : 'good'

  return (
    <div className="p-6 max-w-7xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900">Scheduling</h1>
        <p className="text-sm text-zinc-600 mt-1">
          Native scheduling engine state + every diagnostic surface in one place. All read-only —
          each tile deep-links to the page that does the action.
        </p>
      </header>

      {error && <div className="mb-4 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</div>}

      <section className="mb-6">
        <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">At a glance</div>
        {loading || !c ? (
          <div className="text-sm text-zinc-500">Loading…</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Pending holds" value={c.primaryHolds} hint="rank=1, REQUESTED" />
            <Stat
              label="Stale holds"
              value={c.staleHolds}
              hint={`>${data?.staleDays}d, awaiting sweep`}
              tone={staleTone}
            />
            <Stat label="Backup holds" value={c.backupHolds} hint="rank ≥ 2 queued" />
            <Stat label="Assignments" value={c.bookingAssignments} hint="active asset↔window" />
            <Stat label="Serviceable assets" value={c.serviceableAssets} hint={`${c.totalAssets} active total`} />
          </div>
        )}
      </section>

      <section className="mb-6">
        <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Migration state</div>
        {loading || !c ? (
          <div className="text-sm text-zinc-500">Loading…</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Stat label="Imported from Planyo" value={c.planyoImported} hint="Bookings with source=PLANYO_BACKFILL" />
            <Stat
              label="Cart ID stamped"
              value={c.cartIdStamped}
              hint={cartIdGap > 0 ? `${cartIdGap} pending backfill on next --write` : 'fully idempotent'}
              tone={cartIdTone}
            />
            <Stat label="Categories" value={c.categoriesPublished} hint="published AssetCategory rows" />
          </div>
        )}
      </section>

      <section className="mb-6">
        <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Diagnostic surfaces</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <DiagTile
            href="/stale-holds"
            title="Stale holds"
            description={`Manual sweep of REQUESTED rank-1 holds older than ${data?.staleDays ?? 14} days. Release flips status to UNFULFILLED.`}
            badge={c ? { label: `${c.staleHolds} stale`, tone: staleTone } : undefined}
          />
          <DiagTile
            href="/gantt"
            title="Timeline (gantt)"
            description="Production Timeline view — live book."
          />
        </div>
      </section>

      <section className="mb-6">
        <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Write paths (operator-gated)</div>
        <div className="bg-white border border-zinc-200 rounded-lg p-4 text-sm text-zinc-700">
          <p>
            Two scripts in <code className="text-xs bg-zinc-100 px-1 rounded">scripts/</code> handle the
            one-time Planyo migration. Both default to dry-run; pass <code className="text-xs bg-zinc-100 px-1 rounded">--write</code> to persist.
          </p>
          <ol className="list-decimal pl-5 mt-2 space-y-1 text-zinc-700">
            <li>
              <code className="text-xs bg-zinc-100 px-1 rounded">scheduling-add-missing-assets.ts</code> — creates the
              Lankershim Studios category + 4 stages + Video Van Asset.
            </li>
            <li>
              <code className="text-xs bg-zinc-100 px-1 rounded">scheduling-planyo-migration.ts</code> — pulls
              Planyo forward book; creates Booking + BookingItem (+ BookingAssignment where the unit name
              matches). Cart-level idempotent — safe to re-run.
            </li>
          </ol>
          <p className="mt-2 text-xs text-zinc-500">
            Cutover procedure lives in <code className="text-xs bg-zinc-100 px-1 rounded">native-scheduling-v1-brief.md</code> §Chunk 8 (gated on
            Julian's residuals + migration write + shadow convergence).
          </p>
        </div>
      </section>
    </div>
  )
}
