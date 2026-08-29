/**
 * The dedup allowlist, with NO server imports.
 *
 * Split out of dedupAccess.ts so a client component can ask "should this
 * person see the dedup entry point?" without dragging prisma and next-auth
 * into the browser bundle. dedupAccess.ts re-exports these and remains the
 * only place that ENFORCES anything — this module just answers the question
 * the UI needs to decide whether to render a link.
 *
 * Why an allowlist and not the ADMIN role: merges are audited-reversible but
 * easy to fire and hard to un-fire once many stack up, so the ceiling is an
 * explicit, code-review-gated list. `DEDUP_ALLOWLIST` widens it without a
 * deploy (a contractor doing a one-week cleanup pass), same as HR's.
 */

const DEDUP_ALLOWLIST_BASE: ReadonlyArray<string> = ['wes@sirreel.com', 'dani@sirreel.com']

export function normalizedAllowlist(): Set<string> {
  const set = new Set<string>(DEDUP_ALLOWLIST_BASE.map((e) => e.toLowerCase()))
  const envRaw = process.env.DEDUP_ALLOWLIST
  if (envRaw) {
    for (const e of envRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
      set.add(e)
    }
  }
  return set
}

export function isAllowedDedupEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return normalizedAllowlist().has(email.toLowerCase())
}
