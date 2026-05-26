'use client'

/**
 * /exec/coverage — generic Exec/Coverage role view.
 *
 * Not "Dani's page" — built as a role view from the start. While she's
 * out, ADMINs (Wes + Dani when she's back) see it via the `coverage`
 * permission. Interim ownership is display config, not the route name.
 *
 * Page composes two cards from the dedicated /api/exec/* endpoints:
 *   - Card A — Approvals queue (contract reviews, COIs, change
 *     decisions, annual renewals)
 *   - Card B — Sales execution hygiene (overdue follow-ups, stale
 *     deals, unsent drafts, expiring quotes)
 *
 * Triage roll-up at the top (STEP 4) will compose from the same two
 * endpoint responses — no third API call needed.
 */

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { can } from '@/lib/permissions'
import type { UserRole } from '@prisma/client'
import {
  ApprovalsQueueCard,
  type ApprovalsData,
} from '@/components/exec/ApprovalsQueueCard'
import {
  SalesHygieneCard,
  type SalesHygieneData,
} from '@/components/exec/SalesHygieneCard'

export default function CoveragePage() {
  const { data: session, status: authStatus } = useSession()
  const router = useRouter()
  const [approvals, setApprovals] = useState<ApprovalsData | null>(null)
  const [hygiene, setHygiene] = useState<SalesHygieneData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const role = (session?.user as { role?: UserRole } | undefined)?.role ?? null
  const hasAccess = role ? can(role, 'coverage') : false

  // Client-side guard mirrors the server `coverage` perm. The API itself
  // is the real gate (requireCoverageAccess) — this just keeps the UI
  // honest and bounces non-ADMIN users back to /dashboard rather than
  // showing them an empty page with a 403 in the network panel.
  useEffect(() => {
    if (authStatus === 'loading') return
    if (!session || !hasAccess) {
      router.replace('/dashboard')
    }
  }, [authStatus, session, hasAccess, router])

  useEffect(() => {
    if (authStatus !== 'authenticated' || !hasAccess) return
    let cancelled = false
    Promise.all([
      fetch('/api/exec/approvals', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/exec/sales-hygiene', { cache: 'no-store' }).then((r) => r.json()),
    ])
      .then(([a, b]) => {
        if (cancelled) return
        if (a?.error || b?.error) {
          setError(a?.error || b?.error)
          return
        }
        setApprovals(a)
        setHygiene(b)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load')
      })
    return () => {
      cancelled = true
    }
  }, [authStatus, hasAccess])

  if (authStatus === 'loading' || !hasAccess) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-zinc-500 text-sm">
        Loading…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white">Coverage</h1>
          <p className="text-xs text-zinc-500 mt-1">
            Exec view — approvals and sales-execution exceptions in one place.
          </p>
        </div>
      </div>

      {error && (
        <div className="text-xs px-3 py-2 rounded bg-red-500/10 text-red-300 border border-red-500/30">
          {error}
        </div>
      )}

      <ApprovalsQueueCard data={approvals} />
      <SalesHygieneCard data={hygiene} />
    </div>
  )
}
