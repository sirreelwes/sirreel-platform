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
 * ── Saturday, and why it says 7:30 ─────────────────────────────────────
 * The flyer this replaced said 7:30 AM, and every after-hours surface has
 * been telling clients 7:30 AM since. Jose's 2026-09-03 quote said 7:00 AM.
 * One of the two is wrong and it is not safe to guess: opening half an hour
 * later than a client was told is a driver sitting at a locked gate. Kept at
 * the flyer's 7:30 pending Wes's ruling — change it HERE and the quote PDF,
 * the portal, and the after-hours packet all follow.
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
