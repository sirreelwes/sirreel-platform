/**
 * Team-metrics allowlist. Code-reviewed constant — NOT DB-managed.
 *
 * Pure: no next-auth, no Prisma, no NextResponse. permissions.ts imports this
 * to decide the nav row and permissions is pulled into client bundles, so the
 * membership test has to stay dependency-free. The gate that enforces it is
 * next door in access.ts. Same split as payroll and AP.
 *
 * Wes, 2026-09-09: "for my eyes only." One name.
 *
 * This list is the narrowest in the app on purpose. Payroll exposes what
 * people are paid; this exposes a judgement ABOUT them — how much they
 * appear to be getting done — assembled from their mail and their clicks.
 * A manager seeing their own report's numbers is a different decision from
 * the owner seeing everyone's, and it is not one this file should make
 * quietly. Adding a name here is a review-and-deploy, and the env var
 * (TEAM_METRICS_ALLOWLIST) MERGES rather than replaces so an emergency
 * grant can be removed by changing one env value back.
 *
 * Deliberately separate from PAYROLL_ALLOWLIST even though both hold Wes
 * today: "what we pay this person" and "how productive this person looks"
 * are different grants, and bringing a bookkeeper into one must never hand
 * them the other.
 */

const TEAM_METRICS_ALLOWLIST_BASE: ReadonlyArray<string> = ['wes@sirreel.com']

function normalizedAllowlist(): Set<string> {
  const set = new Set<string>(TEAM_METRICS_ALLOWLIST_BASE.map((e) => e.toLowerCase()))
  const envRaw = process.env.TEAM_METRICS_ALLOWLIST
  if (envRaw) {
    for (const e of envRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
      set.add(e)
    }
  }
  return set
}

export function isAllowedTeamMetricsEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return normalizedAllowlist().has(email.toLowerCase())
}
