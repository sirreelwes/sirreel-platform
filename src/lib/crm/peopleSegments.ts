/**
 * People-side sales segments for /crm.
 *
 * The Companies tab has had server-driven segment chips for a while
 * (topClients / quiet / discount / neverOrdered). The People tab had
 * only role chips — the route literally carried the comment "the
 * /api/crm/people route doesn't take a segment param yet". So the tab
 * that lists the 5,000 humans you actually email could not answer
 * "who haven't we spoken to since spring".
 *
 * ── Two rules these follow ──────────────────────────────────────────
 *
 * 1. Filtering happens SERVER-side, before the page slice. A chip that
 *    filtered the loaded 100 rows would silently mean "the top 100 by
 *    spend that also match", which is not a segment, it is a coincidence.
 *
 * 2. Counts come from the full population, not the page. Same reason the
 *    Companies chips pull theirs from /api/crm/stats: a count that moves
 *    when you paginate teaches people to distrust it.
 *
 * Definitions are deliberately boring and explainable. Every one of
 * these has to survive a sales rep asking "why is this person in here",
 * and the answer must be one sentence.
 */

/** Days without a booking before a contact reads as gone quiet. */
export const PEOPLE_QUIET_DAYS = 90
/** Bookings needed to count as a repeat customer. */
export const PEOPLE_REPEAT_MIN = 3
/** How recently a contact must have been added to count as new. */
export const PEOPLE_NEW_DAYS = 90

export const PEOPLE_SEGMENT_KEYS = [
  'noRole',
  'neverContacted',
  'quiet',
  'repeat',
  'topClientStaff',
  'newContacts',
  'mine',
] as const

export type PeopleSegmentKey = (typeof PEOPLE_SEGMENT_KEYS)[number]

export interface PeopleSegmentMeta {
  key: PeopleSegmentKey
  label: string
  /** Shown as the chip's title attribute — the one-sentence answer. */
  description: string
  /** Copy for an empty result, so a zero never looks like a bug. */
  emptyMessage: string
  /**
   * True when this segment reads a per-contact spend/booking rollup that
   * NOTHING CURRENTLY POPULATES.
   *
   * Measured 2026-08-28: Company.totalSpend is 0 across all 4,207
   * companies, and Person.totalSpend / totalBookings / lastBookingAt are
   * zero or null for every one of the 5,182 contacts. Only 22 orders
   * exist in HQ at all — billing is still RentalWorks' job — so there is
   * nothing to roll up from yet.
   *
   * These segments would therefore return 0 forever, and a plain "0"
   * reads as "nobody qualifies" when the truth is "we do not compute
   * this". The chip renders in an explicitly unavailable state instead,
   * and starts working on its own the day the rollup lands.
   *
   * The same gap disables the company-side TOP_CLIENT / REPEAT / LOYAL /
   * QUIET badges and the Companies tab's Top-clients chip — they are all
   * reading the same empty columns.
   */
  needsSpendRollup?: true
}

export const PEOPLE_SEGMENTS: Record<PeopleSegmentKey, PeopleSegmentMeta> = {
  noRole: {
    key: 'noRole',
    label: 'Role unknown',
    description:
      'Contacts whose role is still Other. Open one and read its source mail to classify it.',
    emptyMessage: 'Every contact has a role. That is not a state this book has been in before.',
  },
  neverContacted: {
    key: 'neverContacted',
    label: 'Never contacted',
    description:
      'No logged outreach and no logged activity, ever. Captured from mail but never worked.',
    emptyMessage: 'Every contact has at least one logged touch.',
  },
  quiet: {
    key: 'quiet',
    label: 'Gone quiet',
    description: `Booked with us before, but nothing in the last ${PEOPLE_QUIET_DAYS} days.`,
    emptyMessage:
      'Not available yet — nothing writes a last-booking date onto a contact, so this cannot be computed.',
    needsSpendRollup: true,
  },
  repeat: {
    key: 'repeat',
    label: 'Repeat bookers',
    description: `${PEOPLE_REPEAT_MIN} or more bookings. The people most likely to book again.`,
    emptyMessage:
      'Not available yet — per-contact booking counts are never populated, so this cannot be computed.',
    needsSpendRollup: true,
  },
  topClientStaff: {
    key: 'topClientStaff',
    label: 'Top-client staff',
    description:
      'Works at a company in the top 10% by spend — the same cutoff the Top clients chip uses.',
    emptyMessage:
      'Not available yet — Company.totalSpend is zero for every company, so there is no top decile to be in.',
    needsSpendRollup: true,
  },
  newContacts: {
    key: 'newContacts',
    label: 'New contacts',
    description: `Added in the last ${PEOPLE_NEW_DAYS} days, however they arrived.`,
    emptyMessage: `No contacts have been added in the last ${PEOPLE_NEW_DAYS} days.`,
  },
  mine: {
    key: 'mine',
    label: 'My contacts',
    description: 'Assigned to you.',
    emptyMessage: 'You have no contacts assigned to you.',
  },
}

export function isPeopleSegmentKey(v: unknown): v is PeopleSegmentKey {
  return typeof v === 'string' && (PEOPLE_SEGMENT_KEYS as readonly string[]).includes(v)
}

/** Counts per segment across the whole population. */
export type PeopleSegmentCounts = Record<PeopleSegmentKey, number>

export function emptySegmentCounts(): PeopleSegmentCounts {
  return PEOPLE_SEGMENT_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as PeopleSegmentCounts)
}

/** Cutoff dates, computed once per request so every segment agrees. */
export interface SegmentCutoffs {
  quietBefore: Date
  newAfter: Date
}

export function segmentCutoffs(now: Date = new Date()): SegmentCutoffs {
  const quietBefore = new Date(now)
  quietBefore.setDate(quietBefore.getDate() - PEOPLE_QUIET_DAYS)
  const newAfter = new Date(now)
  newAfter.setDate(newAfter.getDate() - PEOPLE_NEW_DAYS)
  return { quietBefore, newAfter }
}
