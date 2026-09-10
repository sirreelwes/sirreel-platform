'use client'

/**
 * The two create buttons — "Make Reservation" and "New Order" — that
 * replaced "+ New Job" (Wes 2026-09-10: "the new job button is passé.
 * All jobs are triggered by either Make Reservation or New Order").
 *
 * A job is never made on its own any more. Both entry points already
 * resolve the job themselves (JobResolverModal ranks existing jobs
 * before creating one), so a bare job with nothing on it was a step
 * the desk had to take before the step it actually wanted. The job now
 * falls out of the first real thing put on it: a hold on the board or
 * an order to price.
 *
 * Renders in the /jobs toolbar (desktop) and the shell's mobile top
 * bar, which is why it carries its own modal state instead of leaning
 * on a page. `onCreated` lets the jobs list re-read; the modal's own
 * done screen links to the order it made.
 */

import Link from 'next/link'
import { useState } from 'react'
import { useSession } from 'next-auth/react'
import type { UserRole } from '@prisma/client'
import { getPermissions } from '@/lib/permissions'
import { MakeReservationModal } from '@/components/scheduling/MakeReservationModal'
import { notifyJobsChanged } from '@/components/jobs/JobsListProvider'

export function CreateLaunchers({ size = 'toolbar' }: { size?: 'toolbar' | 'mobile' }) {
  const [reserveOpen, setReserveOpen] = useState(false)
  const { data: session } = useSession()
  const sessionRole = (session?.user as { role?: UserRole } | undefined)?.role ?? null
  const sessionSalesOnly = (session?.user as { salesOnly?: boolean } | undefined)?.salesOnly ?? false
  // Same gate the gantt's Make Reservation and the job page's
  // "+ New reservation" use: holding a unit is sales' call.
  const canReserve = sessionRole
    ? getPermissions({ role: sessionRole, salesOnly: sessionSalesOnly }).canCreateBooking
    : false

  const base =
    size === 'mobile'
      ? 'text-[12px] font-bold px-2.5 min-h-[38px] flex items-center rounded-lg whitespace-nowrap'
      : 'text-[12px] font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap'

  return (
    <>
      <div className={`flex items-center ${size === 'mobile' ? 'gap-1.5' : 'gap-2'}`}>
        {canReserve && (
          <button
            type="button"
            onClick={() => setReserveOpen(true)}
            className={`${base} bg-amber-600 hover:bg-amber-500 text-white`}
            title="Book vehicles for a client and job — creates the order and holds the units"
          >
            {size === 'mobile' ? 'Reserve' : 'Make Reservation'}
          </button>
        )}
        {/* The mobile bar is itself near-black, so the zinc-900 button
            the toolbar uses vanishes into it there. */}
        <Link
          href="/orders/new"
          className={`${base} text-white ${size === 'mobile' ? 'bg-zinc-700 hover:bg-zinc-600' : 'bg-zinc-900 hover:bg-zinc-800'}`}
          title="Draft a quote — the job is picked or created on the way"
        >
          New Order
        </Link>
      </div>

      {reserveOpen && (
        <MakeReservationModal
          canBindUnit={canReserve}
          onClose={() => setReserveOpen(false)}
          onCreated={() => notifyJobsChanged()}
        />
      )}
    </>
  )
}
