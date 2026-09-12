/**
 * The client half of the paperwork review queue — no Prisma, so the feed
 * component and the nav can import it. The counting itself lives in
 * src/lib/paperwork/reviewQueue.ts (server only).
 */

/** Why a row needs nothing. Free-text `note` carries the rest. */
export const DISMISS_REASONS = [
  { value: 'RESUBMITTED', label: 'Superseded by a resubmit' },
  { value: 'HANDLED', label: 'Already handled' },
  { value: 'NOT_NEEDED', label: 'Not needed on this job' },
  { value: 'OTHER', label: 'Other' },
] as const

/**
 * Fired on `window` with the fresh queue count whenever the paperwork page
 * changes it (a skip, an undo, a COI decision). The shell listens so the
 * nav badge drops the moment the work is done rather than on the next
 * navigation — the badge and the page are the same number.
 */
export const PAPERWORK_QUEUE_EVENT = 'sirreel_paperwork_queue'
