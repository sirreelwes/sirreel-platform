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

/**
 * Days without a rental before a CLIENT reads as gone quiet.
 *
 * These three segments are company-grain, and the labels say so ("At a
 * quiet client", not "Gone quiet"). Spend and rental history exist only
 * per company — the RentalWorks invoice mirror has no person on it — so
 * attributing a company's $123K to each of its five contacts would put a
 * number on the contact record that no invoice supports. Naming the
 * segment for the company keeps the claim true.
 */
export const PEOPLE_QUIET_DAYS = 90
/** Rentals needed before a client counts as repeat. */
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
    label: 'At a quiet client',
    description: `Works at a company that has rented from us before but not in the last ${PEOPLE_QUIET_DAYS} days.`,
    emptyMessage: `No client with rental history has gone ${PEOPLE_QUIET_DAYS} days without one.`,
  },
  repeat: {
    key: 'repeat',
    label: 'At a repeat client',
    description: `Works at a company with ${PEOPLE_REPEAT_MIN} or more rentals. The relationships most likely to produce another.`,
    emptyMessage: `No client has reached ${PEOPLE_REPEAT_MIN} rentals yet.`,
  },
  topClientStaff: {
    key: 'topClientStaff',
    label: 'At a top client',
    description:
      'Works at a company in the top 10% by spend — the same cutoff the Companies tab uses.',
    emptyMessage: 'No company has crossed the top-decile spend cutoff.',
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
