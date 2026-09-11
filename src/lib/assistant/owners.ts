/**
 * Owners — the only people AHA lets read `docs/owners/`.
 *
 * Wes 2026-09-11: the succession notes (who steps in as CEO, what they
 * need to know) are "internal notes for owners and not for anyone on the
 * staff other than Tamara, Greyson and Wes." Every ADMIN can already ask
 * AHA for the platform memory, so those notes cannot sit in CLAUDE.md,
 * SHIPLOG.md or the rest of docs/ — they live under docs/owners/, and
 * platformMemory() only reads that folder for a caller whose email is on
 * this list AND who resolves to the admin level (see senderIdentity.ts).
 *
 * The list is the AHA_OWNER_EMAILS environment variable (comma-separated),
 * NOT a constant here — so the names are never in git. Unset, it is Wes
 * alone. Pure; safe to import anywhere.
 */
const DEFAULT_OWNERS = ['wes@sirreel.com']

export const OWNERS_DIR = 'docs/owners'

export function ownerEmails(raw: string | undefined = process.env.AHA_OWNER_EMAILS): string[] {
  const parsed = (raw ?? '')
    .split(/[,\s;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes('@'))
  return parsed.length ? Array.from(new Set(parsed)) : DEFAULT_OWNERS
}

export function isOwnerEmail(email: string | null | undefined, raw?: string): boolean {
  const e = (email ?? '').trim().toLowerCase()
  return Boolean(e) && ownerEmails(raw).includes(e)
}

/** Is this repo-relative markdown path inside the owners' folder? Pure. */
export function isOwnersPath(relPath: string): boolean {
  const p = relPath.replace(/\\/g, '/').replace(/^\.\//, '')
  return p === OWNERS_DIR || p.startsWith(`${OWNERS_DIR}/`)
}
