import type { UserRole } from '@prisma/client'
import type { NextRequest } from 'next/server'

/**
 * Admin "View As" — a faithful, downgrade-only role preview.
 *
 * Wes 2026-08-24: "when I select other views like billing and sales,
 * the screen should show exactly what they see." The old version
 * swapped only the sidebar (and persisted in localStorage, which is
 * banned in this repo and once left Wes silently browsing as Billing
 * for days). This version:
 *
 *   - lives in a SESSION cookie (`sr_view_as`, no max-age): it dies
 *     with the browser session and never silently sticks;
 *   - reaches the SERVER: read routes that redact by role (client
 *     contacts, pricing) honor it, so the preview shows the data that
 *     role would actually receive;
 *   - can only DOWNGRADE: it is honored solely when the session's
 *     DB role is ADMIN. A non-admin sending the cookie changes
 *     nothing, so it grants nothing.
 *
 * Mutations are deliberately NOT downgraded — previewing is looking.
 * An admin who clicks a write action while previewing still acts as
 * themselves, and the audit trail stays truthful.
 */

export const VIEW_AS_COOKIE = 'sr_view_as'

const PREVIEWABLE: ReadonlySet<string> = new Set([
  'MANAGER',
  'AGENT',
  'BILLING',
  'FLEET_TECH',
  'WAREHOUSE',
  'DRIVER',
  'CLIENT',
])

/** Server side: the role whose VIEW the response should render. */
export function effectiveViewRole(realRole: UserRole, req: NextRequest): UserRole {
  if (realRole !== 'ADMIN') return realRole
  const c = req.cookies.get(VIEW_AS_COOKIE)?.value
  if (c && PREVIEWABLE.has(c)) return c as UserRole
  return realRole
}

/**
 * The real-world shape of a previewed role. Every AGENT on the roster is
 * salesOnly (Jose, Oliver) — Ana moved to BILLING — so previewing "Sales"
 * must carry the salesOnly strip or it shows a department nobody occupies
 * and quietly grants billing surfaces Jose can't reach (caught 2026-08-24
 * when previewing Sales still rendered Receivables).
 */
export function previewSalesOnly(role: string | null | undefined): boolean {
  return role === 'AGENT'
}

/** Client side: read the active preview role, if any. */
export function readViewAsCookie(): string | null {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(/(?:^|;\s*)sr_view_as=([^;]+)/)
  const v = m ? decodeURIComponent(m[1]) : null
  return v && PREVIEWABLE.has(v) ? v : null
}

/** Client side: set or clear the preview (session cookie — no max-age). */
export function writeViewAsCookie(role: string | null): void {
  if (typeof document === 'undefined') return
  if (role && PREVIEWABLE.has(role)) {
    document.cookie = `${VIEW_AS_COOKIE}=${encodeURIComponent(role)}; path=/; samesite=lax`
  } else {
    document.cookie = `${VIEW_AS_COOKIE}=; path=/; max-age=0; samesite=lax`
  }
}
