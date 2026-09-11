/**
 * Individually-granted yard access. Code-reviewed constant — NOT DB-managed.
 *
 * The yard surfaces (/yard, the two check in/out report desks, the pick
 * lists) derive from the permissions matrix: `fleet` opens the board and
 * the report desks, `warehouse` opens the pick lists. Both are false for
 * AGENT, and the salesOnly strip re-clears `fleet` on top of that, so a
 * sales rep gets the "Yard access required" wall and a 403 from
 * /api/picklists.
 *
 * Jose asked for the warehouse surface to walk the processes himself
 * (Wes, 2026-09-08); Oliver got the same grant on the same terms
 * (Wes, 2026-09-11). Why an address and not a role change:
 *   - MANAGER / WAREHOUSE / FLEET_TECH are all in isFleetYardRole(), which
 *     swaps the user onto the trimmed yard nav. Jose would lose the entire
 *     sales workspace to gain the board.
 *   - Flipping `fleet`/`warehouse` on the AGENT row would hand the pick
 *     floor and order-rewriting check-outs to every current and future
 *     sales agent — two named reps is not the whole AGENT row.
 *   - A per-user column would let an "edit user" form escalate silently.
 *     A code-reviewed constant changes via PR + deploy only.
 *
 * Same shape and rationale as src/lib/collections/allowlist.ts (which
 * already carries Jose for the same reason) and src/lib/claims/allowlist.ts.
 *
 * What this does NOT open: vehicle inspections and handovers. Those guards
 * (requireFleetInspectionAccess, requireVehicleHandoverAccess) carry their
 * own hardcoded role sets and do not read the matrix.
 */

const YARD_ALLOWLIST_BASE: ReadonlyArray<string> = [
  'jose@sirreel.com',
  'oliver@sirreel.com',
]

function normalizedAllowlist(): Set<string> {
  const set = new Set<string>(YARD_ALLOWLIST_BASE.map((e) => e.toLowerCase()))
  const envRaw = process.env.YARD_ALLOWLIST
  if (envRaw) {
    for (const e of envRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
      set.add(e)
    }
  }
  return set
}

export function isAllowedYardEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return normalizedAllowlist().has(email.toLowerCase())
}
