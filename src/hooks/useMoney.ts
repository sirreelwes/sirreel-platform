'use client'

/**
 * Money visibility — one predicate for "should this person see what a
 * job is worth".
 *
 * Wes, 2026-09-03: "money value of jobs should not be visible in
 * warehouse/albert/hugo/fleet view." The yard crew (MANAGER,
 * FLEET_TECH, WAREHOUSE) has always carried seePricing:false — the
 * flag existed, almost nothing read it, and the order and job pages
 * they reach by clicking a reservation printed deal value, line rates,
 * order totals and invoice balances all the same.
 *
 * The flag is the source of truth, not a role list, so a future role
 * inherits the right behaviour by setting one boolean.
 *
 * Honors admin "View As" exactly the way SurfaceGuard does, so
 * previewing as Fleet shows the redacted screen Julian actually gets.
 *
 * NOTE ON SCOPE: this is a UI redaction, not a security boundary — the
 * amounts are still in the API payload. It is the same class of control
 * as SurfaceGuard: it decides what the app SHOWS, and the API gates
 * decide what anyone can DO. Treat a leak here as a display bug, and
 * put anything that must never leave the server behind a route gate.
 */

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import type { UserRole } from '@prisma/client'
import { getPermissions } from '@/lib/permissions'
import { readViewAsCookie, previewSalesOnly } from '@/lib/auth/viewAs'

/** True when this viewer is allowed to see prices, totals and balances. */
export function useMoneyVisible(): boolean {
  const { data: session, status } = useSession()
  const [viewAs, setViewAs] = useState<string | null>(null)

  useEffect(() => {
    setViewAs(readViewAsCookie())
  }, [])

  // Default to HIDDEN while the session resolves: a figure that flashes
  // on screen and then disappears has already been seen.
  if (status === 'loading') return false

  const user = session?.user as { role?: UserRole; salesOnly?: boolean; email?: string } | undefined
  const realRole = user?.role
  // No role on the session at all — every dashboard page is behind auth,
  // so this is the loading/edge case, not a public viewer. Same safe
  // default as above.
  if (!realRole) return false

  const effective = (realRole === 'ADMIN' && viewAs ? (viewAs as UserRole) : realRole)
  return getPermissions({
    role: effective,
    salesOnly: realRole === 'ADMIN' && viewAs ? previewSalesOnly(viewAs) : !!user?.salesOnly,
    email: user?.email,
  }).seePricing
}

/** What a redacted amount reads as. Not "$0.00" — that is a number. */
export const MONEY_HIDDEN = '—'

/**
 * A currency formatter that returns the em-dash for viewers who may not
 * see money. Drop it in as a same-named local and every existing
 * `fmt(x)` call site redacts without being touched.
 */
export function useMoneyFormatter(
  options: Intl.NumberFormatOptions = {},
): (n: string | number | null | undefined) => string {
  const visible = useMoneyVisible()
  return (n) => {
    if (!visible) return MONEY_HIDDEN
    if (n === null || n === undefined || n === '') return MONEY_HIDDEN
    const v = Number(n)
    if (!Number.isFinite(v)) return MONEY_HIDDEN
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      ...options,
    }).format(v)
  }
}
