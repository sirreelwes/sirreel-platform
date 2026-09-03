/**
 * /yard — the warehouse + fleet crew's one screen.
 *
 * Wes, 2026-09-02: "combine fleet and warehouse into one view. no need
 * to separate." This replaces /fleet/today (trucks) and the landing role
 * of /warehouse/pick (gear) with a single day board grouped by SHOW, so
 * a job that takes a 10-ton and four carts is one card with five rows
 * instead of two queues on two screens that never mention each other.
 *
 * Inside the (dashboard) group, unlike its /fleet/today predecessor: the
 * shell's mobile sheet nav means the phone case is covered now, and one
 * chrome for the whole crew beats two. The task screens it links into
 * (/fleet/inspection, /warehouse/pick/[id]) are unchanged.
 */

import Link from 'next/link'
import { Lock, ArrowRight } from 'lucide-react'
import { getYardUser } from '@/lib/yard/requireYardAccess'
import { yardBoardFor, pacificYmd } from '@/lib/yard/board'
import { YardBoard } from '@/components/yard/YardBoard'

export const dynamic = 'force-dynamic'

export default async function YardPage() {
  const user = await getYardUser()

  if (!user) {
    return (
      <div className="max-w-sm mx-auto text-center py-16 px-6">
        <Lock size={32} aria-hidden className="mx-auto mb-3 text-zinc-500" />
        <h1 className="text-white text-lg font-semibold mb-2">Yard access required</h1>
        <p className="text-zinc-400 text-sm">
          The yard board is for fleet and warehouse staff. Ask Wes or Hugo if you need it.
        </p>
      </div>
    )
  }

  const today = pacificYmd(0)
  const board = await yardBoardFor(today)

  return (
    <div className="max-w-2xl mx-auto px-1 py-2">
      <header className="mb-5">
        <div className="text-amber-500 text-xs font-semibold uppercase tracking-wide mb-1">Yard</div>
        <h1 className="text-white text-2xl font-bold">
          Hi {user.name?.split(' ')[0] || 'there'}
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Everything going out and coming back — trucks and gear together.
        </p>
      </header>

      <YardBoard initial={board} today={today} />

      <footer className="mt-8 pt-4 border-t border-zinc-800 flex flex-wrap gap-x-5 gap-y-2 text-xs">
        <Link href="/warehouse/pick" className="text-zinc-500 hover:text-amber-500 inline-flex items-center gap-1">
          All pick lists
          <ArrowRight size={12} aria-hidden />
        </Link>
        <Link href="/dispatch" className="text-zinc-500 hover:text-amber-500 inline-flex items-center gap-1">
          Deliveries &amp; pickups
          <ArrowRight size={12} aria-hidden />
        </Link>
        <Link href="/fleet" className="text-zinc-500 hover:text-amber-500 inline-flex items-center gap-1">
          Fleet roster
          <ArrowRight size={12} aria-hidden />
        </Link>
      </footer>
    </div>
  )
}
