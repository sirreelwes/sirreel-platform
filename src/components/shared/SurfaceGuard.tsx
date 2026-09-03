'use client'

/**
 * SurfaceGuard — a clean "not your surface" page instead of a broken one.
 *
 * Wes 2026-08-24, closing the by-URL question: middleware routes by host
 * only, so any signed-in user can LOAD any page shell by typing its URL.
 * The APIs behind them enforce the real rules, but a refused page used to
 * render as a skeleton with empty tables and silent failures — it read as
 * "HQ is broken" rather than "this isn't yours".
 *
 * NOTE: THIS IS COSMETIC. It is NOT the security boundary and must never be
 * treated as one: it runs in the browser, and anyone can bypass it with
 * devtools. The boundary is the per-route API gate (see the 2026-08-24
 * hardening of rentalworks/invoices, reconcile/*, and fleet). Only apply
 * this to surfaces whose APIs ALREADY refuse the same roles — then it
 * changes nobody's access, it only explains the refusal.
 *
 * Honors admin "View As" (src/lib/auth/viewAs), so previewing Sales shows
 * the same polite wall Jose would hit.
 */

import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import type { UserRole } from '@prisma/client'
import { getPermissions, defaultLandingPath, type Permissions } from '@/lib/permissions'
import { readViewAsCookie, previewSalesOnly } from '@/lib/auth/viewAs'

export function SurfaceGuard({
  need,
  label,
  children,
}: {
  /** The Permissions view flag this surface belongs to. */
  need: keyof Permissions
  /** Human name of the surface, for the message. */
  label: string
  children: ReactNode
}) {
  const { data: session, status } = useSession()
  const [viewAs, setViewAs] = useState<string | null>(null)

  useEffect(() => {
    setViewAs(readViewAsCookie())
  }, [])

  // Never flash the wall while the session resolves.
  if (status === 'loading') {
    return <div className="min-h-[40vh] flex items-center justify-center text-sm text-gray-400">Loading…</div>
  }

  const user = session?.user as { role?: UserRole; salesOnly?: boolean; email?: string } | undefined
  const realRole = user?.role
  if (!realRole) return <>{children}</>

  // Admin previewing another role sees that role's experience.
  const effective = (realRole === 'ADMIN' && viewAs ? (viewAs as UserRole) : realRole)
  const perms = getPermissions({
    role: effective,
    salesOnly: realRole === 'ADMIN' && viewAs ? previewSalesOnly(viewAs) : !!user?.salesOnly,
    email: user?.email,
  })

  if (perms[need]) return <>{children}</>

  const home = defaultLandingPath(effective)
  return (
    <div className="min-h-[50vh] flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400">{label}</div>
        <h1 className="mt-2 text-xl font-bold text-gray-900">This isn&rsquo;t one of your surfaces</h1>
        <p className="mt-2 text-[13px] text-gray-500 leading-relaxed">
          {label} belongs to another part of the team, so it isn&rsquo;t in your sidebar and the page has
          nothing to show you. Nothing is broken — you just landed somewhere that isn&rsquo;t yours.
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Link
            href={home}
            className="text-[12px] font-bold px-3 py-1.5 rounded-lg bg-gray-900 hover:bg-gray-800 text-white"
          >
            Back to my work
          </Link>
        </div>
        <p className="mt-3 text-[11px] text-gray-400">
          Think you should have access? Ask Wes to change your role.
        </p>
      </div>
    </div>
  )
}
