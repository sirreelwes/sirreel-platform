/**
 * Who may write off a debt — and undo a write-off.
 *
 * A write-off is a tax event with the owner's name on the filing, so it is the
 * owner's call (Wes, 2026-08-19). An explicit email allowlist rather than a
 * role, for the same reason as src/lib/collections/allowlist.ts: the blast
 * radius stays with the person actually named, not with a role somebody may be
 * granted later.
 *
 * Lifted out of api/collections/aging-review/route.ts, where it was an inline
 * const with no env override — the only email gate in HQ that could not be
 * changed without a deploy. That mattered during the VerMar handover: every
 * other gate (HR, claims, dedup, export approval) could admit
 * wes@vermardesign.com by setting an env var, and this one could not.
 *
 * Mirrors src/lib/exports/approver.ts in shape, including the merge semantics:
 * WRITE_OFF_APPROVER_EMAILS is ADDED to the base list, never replaces it, so
 * setting it can only widen access and Wes cannot lock himself out with a typo.
 * (Contrast src/lib/authDomains.ts, where the env var deliberately REPLACES the
 * default — a tenancy boundary has to be able to shrink.)
 */

const WRITE_OFF_APPROVERS_BASE: ReadonlyArray<string> = [
  'wes@sirreel.com',
]

function approverSet(): Set<string> {
  const set = new Set<string>(WRITE_OFF_APPROVERS_BASE.map((e) => e.toLowerCase()))
  const envRaw = process.env.WRITE_OFF_APPROVER_EMAILS
  if (envRaw) {
    for (const e of envRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
      set.add(e)
    }
  }
  return set
}

/** True only for the human(s) permitted to write off — or un-write-off — a debt. */
export function canWriteOff(email: string | null | undefined): boolean {
  if (!email) return false
  return approverSet().has(email.toLowerCase())
}
