/**
 * BookingStatus values and the portal paperwork lock, in one
 * Prisma-free place.
 *
 * ── Why Prisma-free ────────────────────────────────────────────────
 * The client portal (`src/app/portal/[token]/page.tsx`) is a `'use
 * client'` component and needs this. PersonRole is a VALUE, not just a
 * type, so importing the enum would pull the whole Prisma client into
 * the browser bundle. The strings match the enum exactly, and
 * `tests/bookings/status.test.ts` asserts that against the real
 * `@prisma/client` enum so the two cannot drift apart silently.
 *
 * ── Why this exists at all ─────────────────────────────────────────
 * The portal was gating read-only mode on
 * `['CONFIRMED', 'ACTIVE', 'COMPLETE', 'CLOSED']`. BookingStatus has
 * never had COMPLETE or CLOSED. Being a JS `.includes()` on a string
 * those were inert rather than throwing — unlike the identical typo in
 * /api/alerts/seed, which 500'd every dashboard load (d6ebd0a) — but
 * they hid real gaps in BOTH directions: RETURNED, ARCHIVED and
 * CANCELLED bookings stayed editable, while CONFIRMED and ACTIVE ones
 * were locked out of signing that they still needed to do.
 */

/** Every BookingStatus, in lifecycle order. Mirrors the Prisma enum. */
export const BOOKING_STATUS_VALUES = [
  'REQUEST',
  'AI_REVIEW',
  'PENDING_APPROVAL',
  'CONFIRMED',
  'ACTIVE',
  'RETURNED',
  'CANCELLED',
  'ARCHIVED',
] as const

export type BookingStatusValue = (typeof BOOKING_STATUS_VALUES)[number]

/**
 * Why a client can no longer edit their paperwork, or null while they
 * still can.
 *
 * The distinction matters for what we TELL them. "This rental has been
 * confirmed. Documents are read-only." is reassuring on a booking that
 * ran and nonsense on one that was cancelled.
 */
export type PortalLockReason = 'settled' | 'cancelled'

/**
 * Paperwork locks ONLY for genuinely terminal bookings.
 *
 * This follows the ruling already made and documented in the v2 portal
 * (`src/app/portal/v2/[token]/page.tsx`), which the legacy portal never
 * picked up:
 *
 *   A CONFIRMED or ACTIVE booking MUST stay signable. Stage holds —
 *   Planyo imports and gantt "Booked" alike — routinely carry CONFIRMED
 *   before any paperwork exists at all, and collecting signatures on
 *   exactly those jobs is the entire point of the portal. Locking them
 *   is worse than the dead 'COMPLETE'/'CLOSED' strings this replaces:
 *   it is the portal refusing to do its only job.
 *
 *   Documents that ARE signed lock themselves through their per-doc
 *   done state, so opening CONFIRMED back up cannot re-open a signed
 *   agreement.
 *
 *   RETURNED / ARCHIVED — the rental is over; editing now would change
 *     the record behind something that already happened.
 *   CANCELLED — nothing left to paper.
 *
 * An unrecognised status returns null (open) rather than locking. A
 * value we do not know about should never silently shut a client out
 * of paperwork they still owe us.
 */
export function portalLockReason(status: string | null | undefined): PortalLockReason | null {
  switch (status) {
    case 'RETURNED':
    case 'ARCHIVED':
      return 'settled'
    case 'CANCELLED':
      return 'cancelled'
    default:
      return null
  }
}

/** Convenience for callers that only need the boolean. */
export function isPortalPaperworkLocked(status: string | null | undefined): boolean {
  return portalLockReason(status) !== null
}
