/**
 * Yard / lot access hours — the one prisma-free place they live.
 *
 * Lifted out of src/lib/afterHours/instructions.ts on 2026-09-03. The
 * values were already canonical there (they replaced the frozen
 * "Afer Hours EQ P:R.pdf" flyer), but that module imports `@/lib/prisma`
 * at the top level to read the gate codes out of SiteSetting — and
 * `@/lib/prisma` CONSTRUCTS a PrismaClient at import time. Any client
 * component or PDF-side module that wanted the hours would have dragged
 * a Prisma client into its bundle with them.
 *
 * The booking-details block on the quote PDF and the client portal wants
 * exactly these hours and nothing else from that module, so the hours
 * move here and `instructions.ts` re-exports them. One definition, and a
 * change to the lot's hours still lands everywhere at once.
 *
 * ── Saturday is 7:00 AM – 3:30 PM. The flyer's 7:30 was wrong ─────────
 * Wes confirmed the official Saturday hours on 2026-09-03: 7:00 AM to
 * 3:30 PM. The flyer these values were lifted from said 7:30 AM, so every
 * after-hours surface that inherited it had been opening the lot on paper
 * half an hour after it opens in fact — a Saturday driver told 7:30 waits
 * thirty minutes for a gate that is already open, and one told 7:00 when the
 * truth was 7:30 would sit at a locked one. Same class of bug as the frozen
 * gate code the flyer was retired for; it just happened to live in a field
 * nobody thought to re-check.
 *
 * 7:30 is still correct in ONE place and it is not this one:
 * AFTER_HOURS_SUPPORT.staffedHours is when a human answers the phone
 * (7:30 AM – 5:30 PM). The gate opening and the phone being answered are
 * independent facts about different things — do not "reconcile" them.
 */

/** Yard hours. Weekdays as printed on the flyer these replaced; Saturday per
 *  Wes's 2026-09-03 confirmation, which corrected it. */
export const YARD_HOURS = {
  weekdays: '6:00 AM – 6:00 PM, Monday through Friday',
  saturday: '7:00 AM – 3:30 PM, Saturday',
  sunday: 'Closed Sunday',
} as const

/** The same three facts on one line, for a dense block like a quote PDF. */
export const YARD_HOURS_ONE_LINE =
  'Mon–Fri 6:00 AM – 6:00 PM · Sat 7:00 AM – 3:30 PM · Closed Sunday'
