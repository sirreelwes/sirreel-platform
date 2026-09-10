'use client'

/**
 * The Incoming strip — the lifecycle's front door, in two skins.
 *
 * It shipped in the /jobs toolbar; Wes asked for a copy at the top of
 * the left nav (2026-09-09) so the inbound queue is one click away from
 * every page, not just from /jobs. Two mounts, ONE component: the count
 * is two fetches on a 60s poll and a hand-copied second version would
 * drift the first time the SLA or the streams changed.
 *
 * `variant`:
 *  - 'toolbar' — light pill on the /jobs command bar (unchanged look).
 *  - 'nav'     — same pill on the DARK sidebar. The light palette's
 *                white/zinc neutral reads as a hole punched in the nav,
 *                so the neutral state is the nav's own hover surface and
 *                the two alert states are translucent tints of the same
 *                semantic colors.
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Inbox } from 'lucide-react'
import { inquiryPastResponseSla } from '@/lib/sales/inquirySla'

/**
 * Pending-incoming counts — the same two streams NewInboundColumn
 * merges (persistent NEW inquiries + Gmail suggestions), counted the
 * same way, on the same 60s cadence. `count` is null until the first
 * response lands so the badge doesn't flash a zero.
 */
export function useIncomingCount() {
  const [count, setCount] = useState<number | null>(null)
  // Inquiries past the first-response SLA — turns the strip red so the
  // breach is visible from anywhere the strip renders.
  const [overdue, setOverdue] = useState(0)
  useEffect(() => {
    let active = true
    const load = () => {
      Promise.all([
        fetch('/api/inquiries?status=NEW').then((r) => r.json()).catch(() => ({})),
        fetch('/api/sales/suggested-inquiries').then((r) => r.json()).catch(() => ({})),
      ]).then(([inq, sug]) => {
        if (!active) return
        const rows = (inq?.inquiries ?? []) as {
          source: string
          respondedAt?: string | null
          createdAt: string
          // Set when the lead is already an order in HQ — the quote went
          // out on its own thread, so respondedAt never fired. Same
          // pending test New inbound uses (lib/sales/inquiryHandledInHq).
          handledInHq?: unknown | null
        }[]
        const pending = rows.filter((i) => !i.respondedAt && !i.handledInHq)
        setCount(pending.length + ((sug?.suggestions ?? []) as unknown[]).length)
        setOverdue(
          pending.filter((i) => inquiryPastResponseSla({ ...i, respondedAt: i.respondedAt ?? null })).length,
        )
      })
    }
    load()
    const t = setInterval(load, 60_000)
    return () => { active = false; clearInterval(t) }
  }, [])
  return { count, overdue }
}

export function IncomingPill({
  variant = 'toolbar',
  onNavigate,
  touch = false,
  className = '',
}: {
  variant?: 'toolbar' | 'nav'
  /** Sheet mount: close the drawer on tap. */
  onNavigate?: () => void
  /** Sheet mount: pad out to a 44px tap target. */
  touch?: boolean
  className?: string
}) {
  const { count, overdue } = useIncomingCount()
  const nav = variant === 'nav'

  const shell = nav
    ? overdue > 0
      ? 'border-red-400/40 bg-red-500/15 hover:bg-red-500/25'
      : count !== null && count > 0
        ? 'border-amber-400/40 bg-amber-400/15 hover:bg-amber-400/25'
        : 'border-white/10 bg-white/[0.05] hover:bg-white/[0.10]'
    : overdue > 0
      ? 'border-red-300 bg-red-50 hover:bg-red-100'
      : count !== null && count > 0
        ? 'border-amber-300 bg-amber-50 hover:bg-amber-100'
        : 'border-zinc-200 bg-white hover:bg-zinc-100'

  const badge = nav
    ? overdue > 0
      ? 'bg-red-500 text-white'
      : count && count > 0
        ? 'bg-amber-400 text-[#1a1a1a]'
        : 'bg-white/10 text-slate-400'
    : overdue > 0
      ? 'bg-red-500 text-white'
      : count && count > 0
        ? 'bg-amber-500 text-white'
        : 'bg-zinc-100 text-zinc-500'

  return (
    <Link
      href="/jobs?panel=incoming"
      onClick={onNavigate}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-colors ${
        nav
          ? `${touch ? 'min-h-[44px]' : 'py-1.5'}`
          : 'min-h-[44px] md:min-h-0'
      } ${shell} ${className}`}
    >
      <Inbox size={13} aria-hidden className={nav ? 'text-slate-300' : 'text-zinc-500'} />
      <span className={`text-[12px] font-semibold ${nav ? 'text-slate-100' : 'text-zinc-800'}`}>
        Incoming
      </span>
      {overdue > 0 && (
        <span className={`text-[10px] font-bold uppercase tracking-wide ${nav ? 'text-red-300' : 'text-red-600'}`}>
          {overdue} waiting
        </span>
      )}
      {count !== null && (
        <span className={`text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded ${nav ? 'ml-auto' : ''} ${badge}`}>
          {count}
        </span>
      )}
    </Link>
  )
}
