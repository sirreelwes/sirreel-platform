/**
 * Who may use the collections workspace — the single predicate behind BOTH
 * the /collections page gate and the sidebar entry.
 *
 * Kept in its own module (mirroring src/lib/hr/allowlist.ts and
 * src/lib/claims/allowlist.ts) so the nav and the authorization check can
 * never disagree. If they drift, you either hide the page from someone who
 * may use it, or show a tab that dead-ends in a redirect.
 *
 * ADMIN + BILLING covers Wes, Dani and Ana natively.
 *
 * Jose is an explicit address rather than a role: he is AGENT, and gating on
 * AGENT would hand the ability to charge client cards to every current and
 * future sales agent. Add someone here, or give them BILLING if collections
 * is genuinely their job.
 */

const ROLE_ALLOWED: ReadonlySet<string> = new Set(['ADMIN', 'BILLING'])

/** Individually-granted addresses. Lowercase. */
const EMAIL_ALLOWED: ReadonlySet<string> = new Set(['jose@sirreel.com'])

export function canUseCollections(role: string | null | undefined, email?: string | null): boolean {
  if (role && ROLE_ALLOWED.has(String(role))) return true
  if (email && EMAIL_ALLOWED.has(email.toLowerCase())) return true
  return false
}
