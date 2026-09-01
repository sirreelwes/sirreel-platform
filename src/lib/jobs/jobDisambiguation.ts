/**
 * Does a resolve result actually pose a question to a human?
 *
 * Wes, 2026-08-31: "after I parse an email and go to send the quote, it
 * opens a redundant page, which asks for the client info again (she
 * uploaded it herself) as well as asks about job and company again."
 *
 * The JobResolverModal asks "new Job, or an existing one?" That is worth
 * asking when something plausibly IS the same job. But resolveJob's rung
 * ③ awards a candidate 35 points for merely being an open job at the
 * same company — no date, name, contact or thread agreement. True, and
 * useless: it fires for every repeat client, so the modal opened on
 * essentially every quote to a known client, pre-filled from the page,
 * offering the very jobs the Review Quote page already lists inline
 * under its own Job field. The same list, asked twice, the second time
 * as a blocking dialog.
 *
 * Every real identity rung sits above that: nameHint 40, contact 50,
 * companyDates 60, planyoCart 90, thread 100. So 40 is the line between
 * "this client has other jobs" and "this might be one of them".
 *
 * ── Pure by necessity ──────────────────────────────────────────────
 *
 * This lives apart from resolveJob.ts because the Review Quote page is a
 * client component and resolveJob.ts imports Prisma. Importing the
 * predicate from there would drag the database client into the browser
 * bundle.
 */

/** Weakest score that still means "might be the SAME job". */
export const SAME_JOB_EVIDENCE_SCORE = 40

export interface DisambiguationInput {
  bucket: 'CLEAN_MATCH' | 'CANDIDATES' | 'NO_MATCH'
  candidates: Array<{ score: number }>
}

export function needsJobDisambiguation(result: DisambiguationInput): boolean {
  if (result.bucket === 'NO_MATCH') return false
  const top = result.candidates?.[0]
  if (!top) return false
  return top.score >= SAME_JOB_EVIDENCE_SCORE
}
