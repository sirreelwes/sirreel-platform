/**
 * Who may APPROVE an export of SirReel's proprietary data.
 *
 * Wes's standing rule (2026-08-26): exporting the client book, job data, or
 * anything comparable requires approval specifically from Wes Bailey.
 *
 * Why this is an email allowlist and NOT a role check — the load-bearing
 * reason, do not "simplify" it to `role === 'ADMIN'`:
 *
 *   ADMIN is held by BOTH wes@sirreel.com and dani@sirreel.com. A role check
 *   would silently make Dani a second approver, which is precisely what the
 *   rule excludes. There is no OWNER role to key off, and adding a per-user
 *   `canApproveExports` column would let any future "edit user" form escalate
 *   someone into it by accident. A code-reviewed constant changes only via
 *   PR + deploy.
 *
 * Mirrors src/lib/claims/allowlist.ts in shape and rationale, including the
 * env override — EXPORT_APPROVER_EMAILS exists so Wes can delegate during a
 * genuine absence without a deploy. It REPLACES nothing: entries are added to
 * the base list, so Wes never loses his own access by setting it.
 */

const EXPORT_APPROVERS_BASE: ReadonlyArray<string> = [
  'wes@sirreel.com',
]

function approverSet(): Set<string> {
  const set = new Set<string>(EXPORT_APPROVERS_BASE.map((e) => e.toLowerCase()))
  const envRaw = process.env.EXPORT_APPROVER_EMAILS
  if (envRaw) {
    for (const e of envRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
      set.add(e)
    }
  }
  return set
}

/** True only for the human(s) permitted to release proprietary data. */
export function isExportApprover(email: string | null | undefined): boolean {
  if (!email) return false
  return approverSet().has(email.toLowerCase())
}

/**
 * Who may REQUEST an export. Deliberately wider than the approver: staff who
 * can already read the client list on screen may ask for it as a file. The
 * approval — not the request — is the control point, and a request that
 * shouldn't have been made is itself useful signal for Wes.
 *
 * Gated on the `crm` permission so fleet/warehouse roles, who cannot see the
 * client book at all, cannot queue up a request for it either.
 */
export const EXPORT_REQUEST_PERMISSION = 'crm' as const

/**
 * How long an approval stays spendable. An approved export that nobody
 * downloads goes stale rather than sitting as an open-ended license.
 */
export const EXPORT_APPROVAL_TTL_HOURS = Number(
  process.env.EXPORT_APPROVAL_TTL_HOURS || 24,
)
