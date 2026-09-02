/**
 * Payroll allowlist. Code-reviewed constant — NOT DB-managed.
 *
 * Pure: no next-auth, no Prisma, no NextResponse. That is deliberate —
 * src/lib/permissions.ts imports this to decide the nav row, and permissions
 * is pulled into client bundles. The server-side gate that actually enforces
 * it lives next door in access.ts.
 *
 * A SEPARATE list from the HR allowlist even though it holds the same two
 * names today. HR access is about personnel files; payroll access is about
 * compensation. Bringing an outside HR investigator in under HR_ALLOWLIST
 * must not hand them the payroll grid as a side effect.
 *
 * Why a constant and not a DB flag: payroll is the one surface where a stray
 * write to a permissions row would expose everyone's hours (and, once Phase 2
 * stores rates, their pay). That should only change via review + deploy. The
 * PAYROLL_ALLOWLIST env var exists for emergency expansion — it MERGES with
 * the constant rather than replacing it, and removing it is one deploy.
 */

const PAYROLL_ALLOWLIST_BASE: ReadonlyArray<string> = [
  'wes@sirreel.com',
  'dani@sirreel.com',
]

function normalizedAllowlist(): Set<string> {
  const set = new Set<string>(PAYROLL_ALLOWLIST_BASE.map((e) => e.toLowerCase()))
  const envRaw = process.env.PAYROLL_ALLOWLIST
  if (envRaw) {
    for (const e of envRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
      set.add(e)
    }
  }
  return set
}

export function isAllowedPayrollEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return normalizedAllowlist().has(email.toLowerCase())
}
