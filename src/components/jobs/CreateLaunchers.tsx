'use client'

/**
 * The ONE create button — "New Order / Rez" — and the chooser it opens.
 *
 * It replaced the pair of buttons ("Make Reservation" + "New Order") on
 * 2026-09-12 (Wes: "rather than two separate buttons, let's combine into
 * New Order/Rez button that makes you select — new Reservation, New
 * Order, or Both"). The two buttons had been the answer to "+ New Job"
 * (retired 2026-09-10) — a job is never made on its own; it falls out
 * of the first real thing put on it. That is still true. What changed
 * is that the desk no longer has to know, before it clicks, whether a
 * request is "a reservation" or "an order": the question is asked ON
 * the click, in words, with the third answer most requests want.
 *
 *   Reservation  → MakeReservationModal. Vehicles + dates + client +
 *                  job, one order, holds on save. Nothing else on it.
 *   Order        → /orders/new. The quote builder as before; vehicles
 *                  can still be reserved on it from the section at the
 *                  top, but it opens on the paste/upload step.
 *   Both         → /orders/new?reserve=1. Opens straight in the builder
 *                  with the Reservation section ready — reserve the
 *                  trucks, then add the gear that goes out on them.
 *
 * Renders in the /jobs toolbar (desktop) and the shell's mobile top
 * bar, which is why it carries its own modal state instead of leaning
 * on a page. `onCreated` lets the jobs list re-read; the modal's own
 * done screen links to the order it made.
 *
 * A user who cannot hold a unit (canCreateBooking false) gets no
 * chooser: the button is the plain "New Order" link, because the other
 * two answers would only open doors they cannot walk through.
 */

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { ChevronDown, ClipboardList, Layers, Truck } from 'lucide-react'
import type { UserRole } from '@prisma/client'
import { getPermissions } from '@/lib/permissions'
import { MakeReservationModal } from '@/components/scheduling/MakeReservationModal'
import { notifyJobsChanged } from '@/components/jobs/JobsListProvider'

export function CreateLaunchers({ size = 'toolbar' }: { size?: 'toolbar' | 'mobile' }) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [reserveOpen, setReserveOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const { data: session } = useSession()
  const sessionRole = (session?.user as { role?: UserRole } | undefined)?.role ?? null
  const sessionSalesOnly = (session?.user as { salesOnly?: boolean } | undefined)?.salesOnly ?? false
  // Same gate the gantt's Make Reservation and the job page's
  // "+ New reservation" use: holding a unit is sales' call.
  const canReserve = sessionRole
    ? getPermissions({ role: sessionRole, salesOnly: sessionSalesOnly }).canCreateBooking
    : false

  // Click-away + Escape close the chooser. The mobile bar is a fixed
  // header, so the menu is positioned off this wrapper, not the page.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const base =
    size === 'mobile'
      ? 'text-[12px] font-bold px-2.5 min-h-[38px] flex items-center gap-1 rounded-lg whitespace-nowrap'
      : 'text-[12px] font-semibold px-3 py-1.5 flex items-center gap-1 rounded-lg whitespace-nowrap'

  if (!canReserve) {
    return (
      <Link
        href="/orders/new"
        className={`${base} bg-amber-600 hover:bg-amber-500 text-white`}
        title="Draft a quote — the job is picked or created on the way"
      >
        New Order
      </Link>
    )
  }

  const choices: {
    key: 'reservation' | 'order' | 'both'
    label: string
    detail: string
    Icon: typeof Truck
    go: () => void
  }[] = [
    {
      key: 'reservation',
      label: 'New Reservation',
      detail: 'Hold vehicles for a client and job. One order, just the trucks.',
      Icon: Truck,
      go: () => setReserveOpen(true),
    },
    {
      key: 'order',
      label: 'New Order',
      detail: 'Gear, supplies, stages — a quote to price. Paste an email or build by hand.',
      Icon: ClipboardList,
      go: () => router.push('/orders/new'),
    },
    {
      key: 'both',
      label: 'Both',
      detail: 'Reserve the vehicles, then add the order that goes out on them.',
      Icon: Layers,
      go: () => router.push('/orders/new?reserve=1'),
    },
  ]

  return (
    <>
      <div ref={wrapRef} className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className={`${base} bg-amber-600 hover:bg-amber-500 text-white`}
          title="Start a reservation, an order, or both — the job is picked or created on the way"
        >
          {size === 'mobile' ? 'New' : 'New Order / Rez'}
          <ChevronDown className="w-3.5 h-3.5 opacity-80" aria-hidden />
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-1.5 z-50 w-[300px] rounded-xl border border-lt-hairline bg-lt-card shadow-lg p-1.5"
          >
            <div className="px-2.5 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wide text-lt-fg3">
              What are you starting?
            </div>
            {choices.map(({ key, label, detail, Icon, go }) => (
              <button
                key={key}
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  go()
                }}
                className="w-full text-left flex items-start gap-2.5 rounded-lg px-2.5 py-2 hover:bg-lt-inner"
              >
                <Icon className="w-4 h-4 mt-0.5 shrink-0 text-amber-700" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-lt-fg">{label}</span>
                  <span className="block text-[11px] text-lt-fg2 leading-snug">{detail}</span>
                </span>
              </button>
            ))}
          </div>
        )}
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
