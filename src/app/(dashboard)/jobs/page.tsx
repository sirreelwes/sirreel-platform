'use client'

/**
 * /jobs with nothing selected — the ONE STOP SHOP landing (Wes
 * 2026-08-27: "combine the jobs and inquiries pages … incoming, active
 * and wrapped").
 *
 * The whole lifecycle reads across one screen:
 *   INCOMING — this panel: the live inbound queue (web forms + Gmail
 *              suggestions), the one sent-quotes list with the nudge,
 *              upcoming reservations, and the signals strip. This is
 *              the former /inquiries workspace re-homed, not rebuilt —
 *              /inquiries now redirects here.
 *   ACTIVE  — the sidebar: every job, colored by cycle position,
 *              readiness as the second axis.
 *   WRAPPED — the same sidebar, bottom of the urgency sort (Returned /
 *              Cancelled / Lost), with the status dropdown to narrow.
 *
 * The Going out / Coming back strip moved to /orders (Wes 2026-08-31).
 * The old "book by state" tiles are gone too: the sidebar's legend chips
 * already carry the same counts and the same one-click narrowing, and
 * this page does not repeat the list.
 *
 * Won work converting out of the queue lands as a Job in the left rail
 * — the point of the merge is that it never leaves the page.
 */

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useJobsList } from '@/components/jobs/JobsListProvider'
import { ActionItemsPanel } from '@/components/actionItems/ActionItemsPanel'
import { NewInboundColumn } from '@/components/sales/NewInboundColumn'
import { QuotesOutPanel } from '@/components/sales/QuotesOutPanel'
import { SalesReservationsWidget } from '@/components/sales/SalesReservationsWidget'
import { SalesSignalsStrip } from '@/components/sales/SalesSignalsStrip'
import { CopyIntakeLinkButton } from '@/components/intake/CopyIntakeLinkButton'

export default function JobsLandingPage() {
  const { data: session, status: authStatus } = useSession()
  const role = (session?.user as { role?: string } | undefined)?.role

  // AGENT defaults to My Deals; everyone else to Team — carried over
  // from the inquiries workspace unchanged.
  const [scope, setScope] = useState<'my' | 'team'>('team')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (authStatus !== 'authenticated') return
    setScope(role === 'AGENT' ? 'my' : 'team')
  }, [authStatus, role])

  const refreshAll = () => setRefreshKey((k) => k + 1)

  const { refresh: refreshJobs } = useJobsList()

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* The page title lives in the JobsToolbar (the full-width bar the
          layout renders above the split — Wes 2026-08-28); this header is
          just the landing-panel-specific controls. */}
      <header className="flex items-center justify-end gap-2 flex-wrap">
        <CopyIntakeLinkButton />
        <div className="flex rounded-lg border border-zinc-200 overflow-hidden text-[12px] font-semibold">
          <button
            onClick={() => setScope('my')}
            className={scope === 'my' ? 'px-3 py-1.5 bg-zinc-900 text-white' : 'px-3 py-1.5 bg-white text-zinc-500 hover:bg-zinc-50'}
          >
            My Deals
          </button>
          <button
            onClick={() => setScope('team')}
            className={scope === 'team' ? 'px-3 py-1.5 bg-zinc-900 text-white' : 'px-3 py-1.5 bg-white text-zinc-500 hover:bg-zinc-50'}
          >
            Team View
          </button>
        </div>
      </header>

      {/* Action items — the cross-role "needs a human" registry, folded in
          from /action-items (Wes 2026-08-27). Omits itself when empty. */}
      <ActionItemsPanel />

      {/* Two-column workspace (Wes, 2026-08-22 — layout ruling carried
          over from /inquiries): NEW INBOUND lives in the RIGHT column;
          Quotes out + Upcoming reservations stack in the LEFT column.
          DOM order keeps the live inbound queue FIRST so single-column
          still leads with it; lg:order-* swaps the visual sides.
          onChange also refreshes the jobs list — a conversion should
          appear in the left rail without a reload. */}
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <div className="lg:order-2">
          <NewInboundColumn onChange={() => { refreshAll(); refreshJobs(); }} />
        </div>
        <div className="lg:order-1 space-y-4">
          <QuotesOutPanel scope={scope} refreshKey={refreshKey} />
          <div className="bg-white border border-zinc-200 rounded-xl p-4">
            <SalesReservationsWidget />
          </div>
        </div>
      </div>

      {/* Signals — stale quotes / pending COIs / dormant clients */}
      <SalesSignalsStrip scope={scope} onChange={refreshAll} />
    </div>
  )
}
