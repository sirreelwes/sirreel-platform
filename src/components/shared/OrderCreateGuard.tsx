'use client'

/**
 * "Creating orders is sales' job" — the polite wall on /orders/new.
 *
 * Hugo, 2026-09-03: "create order should not be possible from
 * Fleet/Warehouse view/login. That is only for sales. Modifications to
 * that order can be done but only within Checkout report."
 *
 * Same shape and the same caveat as SurfaceGuard: COSMETIC. It explains
 * a refusal that POST /api/orders already enforces
 * (src/lib/orders/requireOrderCreateAccess.ts) — never trust it as the
 * boundary. It exists because the order builder rendered fine for the
 * yard crew and only failed at the end, on save.
 *
 * Honors admin "View As" so previewing the yard shows the wall.
 */

import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import type { UserRole } from '@prisma/client'
import { canCreateOrders, defaultLandingPath } from '@/lib/permissions'
import { readViewAsCookie, previewSalesOnly } from '@/lib/auth/viewAs'

export function OrderCreateGuard({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession()
  const [viewAs, setViewAs] = useState<string | null>(null)

  useEffect(() => {
    setViewAs(readViewAsCookie())
  }, [])

  if (status === 'loading') {
    return <div className="min-h-[40vh] flex items-center justify-center text-sm text-gray-400">Loading…</div>
  }

  const user = session?.user as { role?: UserRole; salesOnly?: boolean; email?: string } | undefined
  const realRole = user?.role
  // No role resolved — leave the page alone and let the API answer. The
  // same call SurfaceGuard makes, for the same reason.
  if (!realRole) return <>{children}</>

  const effective = (realRole === 'ADMIN' && viewAs ? (viewAs as UserRole) : realRole)
  const allowed = canCreateOrders({
    role: effective,
    salesOnly: realRole === 'ADMIN' && viewAs ? previewSalesOnly(viewAs) : !!user?.salesOnly,
    email: user?.email,
  })
  if (allowed) return <>{children}</>

  return (
    <div className="min-h-[50vh] flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400">New order</div>
        <h1 className="mt-2 text-xl font-bold text-gray-900">Sales writes the orders</h1>
        <p className="mt-2 text-[13px] text-gray-500 leading-relaxed">
          An order is a priced commitment to a client, so it starts with the agent on the job.
          You can still change what actually goes out — do that on the check-out report, which
          updates the order and tells the agent what changed.
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Link
            href="/reports/orders"
            className="text-[12px] font-bold px-3 py-1.5 rounded-lg bg-gray-900 hover:bg-gray-800 text-white"
          >
            Check In/Out Reports
          </Link>
          <Link
            href={defaultLandingPath(effective)}
            className="text-[12px] font-bold px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Back to my work
          </Link>
        </div>
      </div>
    </div>
  )
}
