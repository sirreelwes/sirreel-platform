/**
 * When a hand-made AHA grant stops working.
 *
 * Wes 2026-09-15, asked how a production contact loses access once they are
 * not on a current job: every DERIVED tier already lapses on its own — codes
 * a day past the assignment, job details a week past the job — but a row
 * added by hand on /admin/assistant lasted until a human revoked it. That
 * was the one standing way to hold access between productions.
 *
 * So a grant now carries `expiresAt`:
 *   • CONTACT grants default to the job's end + the same 7-day tail the
 *     derived contact tier gets, so a hand-made contact and a real one
 *     lapse together.
 *   • Everything else defaults to 90 days, long enough to be useful and
 *     short enough that a forgotten row dies.
 *   • NULL is a deliberate never-expires — a long-term partner dispatcher,
 *     say — and the admin page marks those rows so they stand out.
 *
 * Pure. The read path filters in SQL (senderIdentity.activeGrant); this
 * module is that same rule in one testable place.
 */

/** The tail a hand-made CONTACT grant gets past its job's last live date. */
export const CONTACT_GRANT_TAIL_DAYS = 7
/** How long any other hand-made grant lasts when no date is given. */
export const DEFAULT_GRANT_DAYS = 90
/** Refuse an expiry further out than this — a typo'd year should not grant a decade. */
export const MAX_GRANT_DAYS = 400

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setUTCDate(x.getUTCDate() + n)
  return x
}

/**
 * Is this grant live right now? Mirrors the SQL in `activeGrant`.
 * Revoked always wins; a null expiry never lapses.
 */
export function grantIsActive(
  g: { revokedAt?: Date | null; expiresAt?: Date | null },
  now: Date = new Date(),
): boolean {
  if (g.revokedAt) return false
  if (!g.expiresAt) return true
  return g.expiresAt.getTime() > now.getTime()
}

/**
 * The expiry to store for a new grant.
 *
 * `requested` is what an admin typed (a date, or the string "never").
 * `jobEnd` is the job's last live date for a CONTACT grant, when known.
 * Returns null only for an explicit "never".
 */
export function resolveGrantExpiry(input: {
  requested?: Date | 'never' | null
  level: string
  jobEnd?: Date | null
  now?: Date
}): { expiresAt: Date | null; error?: string } {
  const now = input.now ?? new Date()
  if (input.requested === 'never') return { expiresAt: null }
  if (input.requested instanceof Date) {
    if (Number.isNaN(input.requested.getTime())) return { expiresAt: null, error: 'that expiry date is not a date' }
    if (input.requested.getTime() <= now.getTime()) return { expiresAt: null, error: 'that expiry date is already past' }
    if (input.requested.getTime() > addDays(now, MAX_GRANT_DAYS).getTime()) {
      return { expiresAt: null, error: `an expiry more than ${MAX_GRANT_DAYS} days out needs to be "never" on purpose` }
    }
    return { expiresAt: input.requested }
  }
  // Nothing asked for: a contact follows their job, everyone else gets the default.
  if (input.level.toUpperCase() === 'CONTACT' && input.jobEnd) {
    return { expiresAt: addDays(input.jobEnd, CONTACT_GRANT_TAIL_DAYS) }
  }
  return { expiresAt: addDays(now, DEFAULT_GRANT_DAYS) }
}
