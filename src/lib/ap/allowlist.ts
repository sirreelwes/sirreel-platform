/**
 * Accounts-payable allowlist. Code-reviewed constant — NOT DB-managed.
 *
 * Pure: no next-auth, no Prisma, no NextResponse. permissions.ts imports this
 * to decide the nav row and permissions is pulled into client bundles, so the
 * membership test has to stay dependency-free. The server-side gate that
 * actually enforces it lives next door in access.ts. Same split as payroll.
 *
 * Wes, 2026-09-08: "just for my own view." One name, on purpose. This desk
 * shows what SirReel is being billed, next to what the team committed to
 * spend — vendor rates, sub-rental margins and who issued a PO without
 * telling anyone. That is owner-level reading before it is a workflow.
 *
 * A SEPARATE list from payroll's even though it holds the same one name
 * today: payroll is what we pay our people, AP is what we owe outside. The
 * AP_ALLOWLIST env var MERGES with the constant (never replaces it), so
 * bringing a bookkeeper in for a week doesn't need a deploy — and removing
 * them again is one env change.
 */

const AP_ALLOWLIST_BASE: ReadonlyArray<string> = ['wes@sirreel.com']

function normalizedAllowlist(): Set<string> {
  const set = new Set<string>(AP_ALLOWLIST_BASE.map((e) => e.toLowerCase()))
  const envRaw = process.env.AP_ALLOWLIST
  if (envRaw) {
    for (const e of envRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
      set.add(e)
    }
  }
  return set
}

export function isAllowedApEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return normalizedAllowlist().has(email.toLowerCase())
}
