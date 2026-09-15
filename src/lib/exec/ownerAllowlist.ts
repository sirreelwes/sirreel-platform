/**
 * Who may see the owner numbers page (/exec/numbers) — sales, orders and
 * collections for the whole business.
 *
 * Wes, 2026-09-15: "This is only for Wes."
 *
 * An email allowlist and NOT a role check, for the same load-bearing reason as
 * src/lib/exports/approver.ts: ADMIN is held by both Wes and Dani, so
 * `role === 'ADMIN'` would quietly make it a two-person page. There is also no
 * env override here, unlike the export approver — that one exists so an
 * approval can be delegated during an absence, and nothing on this page needs
 * doing while Wes is away. Widening it is a reviewed edit to this list.
 *
 * Kept free of next-auth so permissions.ts can import it for the nav row.
 */

const OWNER_VIEWERS: ReadonlyArray<string> = ['wes@sirreel.com']

export function isOwnerNumbersViewer(email: string | null | undefined): boolean {
  if (!email) return false
  return OWNER_VIEWERS.includes(email.trim().toLowerCase())
}
