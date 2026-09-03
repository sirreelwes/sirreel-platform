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
 * ── Saturday is 7:30, and it has been asked twice ─────────────────────
 * Jose's 2026-09-03 quote said the lot opens 7:00 AM on Saturday. Every
 * after-hours surface says 7:30 AM, inherited from the flyer these values
 * replaced. Raised with Wes on 2026-09-03; his ruling is 7:30 — the quote
 * was the wrong one. Left recorded because the discrepancy is not obvious
 * from either number on its own, and the next person to notice a 7:00 in
 * an old quote should not have to re-open it.
 *
 * Not to be confused with AFTER_HOURS_SUPPORT.staffedHours, which is when a
 * human answers the phone (7:30 AM) and is a different fact about a
 * different thing. That the two currently agree is a coincidence — the gate
 * opening and the phone being answered are not required to match, so do not
 * "consolidate" them.
 */

/** Yard hours, as printed on the flyer this replaced. */
export const YARD_HOURS = {
  weekdays: '6:00 AM – 6:00 PM, Monday through Friday',
  saturday: '7:30 AM – 3:30 PM, Saturday',
  sunday: 'Closed Sunday',
} as const

/** The same three facts on one line, for a dense block like a quote PDF. */
export const YARD_HOURS_ONE_LINE =
  'Mon–Fri 6:00 AM – 6:00 PM · Sat 7:30 AM – 3:30 PM · Closed Sunday'
