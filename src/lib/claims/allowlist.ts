/**
 * Claims pod allowlist. Code-reviewed constant — NOT DB-managed.
 *
 * Phase 4a tightening: canManageClaims (which gates incident
 * worklist edits — severity, assignee, next-action, driver) is now
 * ADMIN-only by role, expanded via this allowlist to bring in the
 * specific non-admin handlers who own claims work. Today: Ana
 * (collections / billing AGENT).
 *
 * Why a separate allowlist and not just a role check:
 *   - Ana's a sales-org AGENT — same role as Jose and Oliver, who
 *     should NOT have claims-edit access. Roles alone can't separate
 *     "this AGENT works claims" from "this AGENT sells trucks."
 *   - Adding a per-user `canManageClaims` boolean to the User table
 *     would let any future "edit user" form accidentally escalate.
 *     A code-reviewed constant changes via PR + deploy only.
 *   - Pattern mirrors src/lib/hr/allowlist.ts — same rationale,
 *     same shape, same CLAIMS_ALLOWLIST env override for emergency
 *     expansion (e.g. bringing in outside counsel for a live matter).
 *
 * Effective claims access today: ADMIN role (Wes, Dani) OR an email
 * on this list (Ana). Adding a handler is one PR line here; the
 * single source feeds both API gate and nav/UI via
 * getPermissions().canManageClaims.
 */

const CLAIMS_ALLOWLIST_BASE: ReadonlyArray<string> = [
  'ana@sirreel.com',
]

function normalizedAllowlist(): Set<string> {
  const set = new Set<string>(CLAIMS_ALLOWLIST_BASE.map((e) => e.toLowerCase()))
  const envRaw = process.env.CLAIMS_ALLOWLIST
  if (envRaw) {
    for (const e of envRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
      set.add(e)
    }
  }
  return set
}

export function isAllowedClaimsEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return normalizedAllowlist().has(email.toLowerCase())
}
