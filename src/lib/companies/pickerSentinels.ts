/**
 * The two non-id values a company selection can carry.
 *
 * The Review Quote form keeps its company choice in one string that is
 * usually a Company id but is sometimes an ANSWER instead:
 *
 *   '__new__'      — create the typed name when the form is submitted
 *   '__unknown__'  — we do not know the company yet (Wes 2026-08-31:
 *                    "I need the option to select 'I don't know company
 *                    yet..' like in Quick Reply"). The Job resolver
 *                    mints a per-job provisional placeholder; see
 *                    ./provisional.
 *
 * Both are real answers, not empty ones — '__unknown__' in particular
 * must not block a save, because a company we do not have yet is the
 * normal state of a phone lead.
 *
 * They must never reach an API expecting a Company id. This lives in its
 * own module so the test can hold the line: the check was previously
 * spelled out inline at four call sites, and when the second sentinel
 * was added one of them — `job.company?.id ?? selectedClientId` — let it
 * straight through, because `??` only falls through on null and a
 * sentinel is a perfectly non-null string.
 */

export const COMPANY_SENTINEL_NEW = '__new__'
export const COMPANY_SENTINEL_UNKNOWN = '__unknown__'

const SENTINELS: ReadonlySet<string> = new Set([
  COMPANY_SENTINEL_NEW,
  COMPANY_SENTINEL_UNKNOWN,
])

/** The id if it is genuinely one, else null. Use before any API call. */
export function realCompanyId(id: string | null | undefined): string | null {
  return id && !SENTINELS.has(id) ? id : null
}

/** Did the rep explicitly say they don't know the company? */
export function isUnknownCompany(id: string | null | undefined): boolean {
  return id === COMPANY_SENTINEL_UNKNOWN
}
